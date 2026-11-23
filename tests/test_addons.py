"""
Ek ölçüler — sıcaklık, swap, load average ve GPU: sensör seçimi ve okuma.

Ek ölçülerin ortak riski şudur: **makinede karşılığı yokken hata vermek ya da
sessizce yanlış şeyi ölçmek.** Biri ölçüm döngüsünü düşürür, diğeri sütuna
makineden makineye farklı anlam taşıyan bir sayı yazar.

Gerçek donanım burada kullanılamaz (bu makinede sensör olabilir, CI'da olmaz;
NVIDIA kartı olabilir, olmayabilir). Bu yüzden psutil ve nvidia-smi taklit
edilir: test edilen şey donanım değil, KARAR — hangi sensör seçiliyor, hangi
alan ne zaman dolduruluyor, hata nasıl yutuluyor.
"""

from __future__ import annotations

import subprocess
from dataclasses import asdict
from types import SimpleNamespace

import psutil
import pytest

from agent.core import metrics as metrics_module
from agent.core.config import ConfigLoader
from agent.core.gpu import GpuReader
from agent.core.inventory import collect_inventory
from agent.core.metrics import MetricsCollector

class Warnings(list):
    """`warn` yerine geçer; basılan uyarıları toplar."""

    def __call__(self, message: str) -> None:
        self.append(message)


def sensor(current: float | None, label: str = "") -> SimpleNamespace:
    """psutil.sensors_temperatures çıktısındaki tek okuma."""
    return SimpleNamespace(label=label, current=current, high=None, critical=None)


class FakeRun:
    """subprocess.run yerine geçer; çağrıları sayar, sonucu testten alır."""

    def __init__(self, stdout: str = "", returncode: int = 0, error: Exception | None = None):
        self._stdout = stdout
        self._returncode = returncode
        self._error = error
        self.calls: list[list[str]] = []

    def __call__(self, command, **kwargs):
        self.calls.append(list(command))
        if self._error is not None:
            raise self._error
        return subprocess.CompletedProcess(command, self._returncode, self._stdout, "")


@pytest.fixture
def collector():
    """CPU yüzdesinin tabanı alınmış bir toplayıcı — ikinci ölçüm gerçek olur."""
    instance = MetricsCollector()
    instance.collect()
    return instance


# --- toplama ---------------------------------------------------------------


def test_extras_are_read_on_every_collect(collector, monkeypatch):
    """Ek ölçüler config'e bakmadan her ölçümde okunur."""
    monkeypatch.setattr(psutil, "swap_memory", lambda: SimpleNamespace(used=512 * 1024 * 1024))

    sample = asdict(collector.collect().sample)

    assert sample["swap_used_mb"] == 512


def test_a_machine_without_sensors_or_gpu_leaves_the_columns_null(collector, monkeypatch):
    """Sensör ve GPU olmayan makinede ölçüm düşmez; ilgili alanlar null kalır."""
    monkeypatch.setattr(psutil, "sensors_temperatures", lambda: {}, raising=False)
    monkeypatch.setattr(subprocess, "run", FakeRun(error=FileNotFoundError()))

    sample = asdict(collector.collect().sample)

    assert sample["temperature_c"] is None
    assert sample["gpu_usage_percent"] is None
    assert sample["gpu_vram_used_mb"] is None


# --- sıcaklık: hangi sensör -------------------------------------------------


def test_known_cpu_sensors_are_preferred_in_order(monkeypatch):
    """Sıra: coretemp -> k10temp -> cpu_thermal -> acpitz.

    Aynı makinede birden fazla sensör bulunur. acpitz (anakart) CPU'ya yalnızca
    yakındır; coretemp çekirdeği doğrudan ölçer. Yanlış sıra, sütuna sistematik
    olarak birkaç derece kaymış bir değer yazar — hata değil, sessiz yanlışlık.
    """
    monkeypatch.setattr(
        psutil,
        "sensors_temperatures",
        lambda: {"acpitz": [sensor(38.0)], "coretemp": [sensor(61.0)]},
        raising=False,
    )

    assert metrics_module._cpu_temperature() == 61.0


def test_unknown_sensors_are_never_used(monkeypatch):
    """Tanınmayan sensör varsa değer null kalır — rastgele bir sensör seçilmez.

    Şemada sensör adı için sütun YOK. "Ne bulursan yaz" kuralı, aynı sütuna bir
    makinede CPU, diğerinde NVMe diskinin sıcaklığını yazardı; iki satır
    karşılaştırılamaz hale gelirdi.
    """
    monkeypatch.setattr(
        psutil,
        "sensors_temperatures",
        lambda: {"nvme": [sensor(52.0)], "iwlwifi_1": [sensor(44.0)]},
        raising=False,
    )

    assert metrics_module._cpu_temperature() is None


def test_sensor_without_a_reading_is_skipped(monkeypatch):
    """Sensör listesi boş ya da değeri None ise sütun null kalır."""
    monkeypatch.setattr(
        psutil,
        "sensors_temperatures",
        lambda: {"coretemp": [], "k10temp": [sensor(None)]},
        raising=False,
    )

    assert metrics_module._cpu_temperature() is None


def test_platform_without_temperature_support_returns_null(monkeypatch):
    """psutil.sensors_temperatures Linux dışında hiç TANIMLI DEĞİLDİR.

    Yokluğunu getattr ile sormak yerine doğrudan çağırmak, Windows'ta
    AttributeError ile ölçüm turunu düşürürdü.
    """
    monkeypatch.delattr(psutil, "sensors_temperatures", raising=False)

    assert metrics_module._cpu_temperature() is None


def test_sensor_read_failure_does_not_break_the_sample(monkeypatch):
    """Sensör okunamazsa yalnızca o alan null olur, ölçüm turu sürer."""

    def explode():
        raise OSError("sensör okunamadı")

    monkeypatch.setattr(psutil, "sensors_temperatures", explode, raising=False)

    assert metrics_module._cpu_temperature() is None


# --- swap ve load average ---------------------------------------------------


def test_zero_swap_is_a_measurement_not_a_missing_value(monkeypatch):
    """Swap'ı olmayan makinede doğru cevap 0'dır, null değil.

    Fark grafikte görünür: null "ölçemedim" der, 0 "kullanılmıyor" der.
    """
    monkeypatch.setattr(psutil, "swap_memory", lambda: SimpleNamespace(used=0))

    assert metrics_module._swap_used_mb() == 0


def test_swap_read_failure_falls_back_to_null(monkeypatch):
    def explode():
        raise OSError("swap okunamadı")

    monkeypatch.setattr(psutil, "swap_memory", explode)

    assert metrics_module._swap_used_mb() is None


def test_load_average_fills_all_three_or_none_of_them():
    """Üç alan tek çağrıdan gelir; biri dolup diğeri boş kalamaz."""
    values = metrics_module._load_average()

    assert set(values) == {"load_avg_1", "load_avg_5", "load_avg_15"}
    assert all(value is not None for value in values.values())


def test_load_average_failure_nulls_all_three(monkeypatch):
    """Platform desteklemiyorsa üçü birden null olur, ölçüm düşmez."""

    def explode():
        raise OSError("desteklenmiyor")

    monkeypatch.setattr(psutil, "getloadavg", explode, raising=False)

    assert metrics_module._load_average() == {
        "load_avg_1": None,
        "load_avg_5": None,
        "load_avg_15": None,
    }


# --- GPU: nvidia-smi --------------------------------------------------------


def test_gpu_usage_is_parsed_from_the_csv_output(monkeypatch):
    """`--format=csv,noheader,nounits` sayıyı birimsiz verir."""
    run = FakeRun(stdout="34, 2100\n")
    monkeypatch.setattr(subprocess, "run", run)

    assert GpuReader().read_usage() == (34.0, 2100)
    assert "--query-gpu=utilization.gpu,memory.used" in run.calls[0]


def test_only_the_first_gpu_is_read(monkeypatch):
    """Çoklu kartta ilk satır alınır — şemada tek sütun var."""
    monkeypatch.setattr(subprocess, "run", FakeRun(stdout="34, 2100\n90, 8000\n"))

    assert GpuReader().read_usage() == (34.0, 2100)


def test_non_numeric_gpu_values_become_null(monkeypatch):
    """Sürücü bir alanı raporlamıyorsa [N/A] yazar; sayı uydurulmaz."""
    monkeypatch.setattr(subprocess, "run", FakeRun(stdout="[N/A], [N/A]\n"))

    assert GpuReader().read_usage() == (None, None)


def test_failed_gpu_query_becomes_null(monkeypatch):
    """Sıfırdan farklı çıkış kodu: sürücü hatası — çıktı ayrıştırılmaz.

    Taklit çıktı BİLEREK ayrıştırılabilir bırakıldı: çıkış kodu denetimi
    kaldırılsaydı, boş bir stdout ile bu test yine yeşil kalırdı. Yarım kalmış
    bir çıktının sayıya çevrilmesi, sürücü hatasını "GPU %34 yüklüydü" diye
    kaydetmek demektir.
    """
    monkeypatch.setattr(subprocess, "run", FakeRun(stdout="34, 2100\n", returncode=9))

    assert GpuReader().read_usage() == (None, None)


def test_gpu_timeout_becomes_null(monkeypatch):
    """Yanıt vermeyen nvidia-smi ölçüm döngüsünü bekletmez."""
    monkeypatch.setattr(
        subprocess, "run", FakeRun(error=subprocess.TimeoutExpired("nvidia-smi", 2.0))
    )

    assert GpuReader().read_usage() == (None, None)


def test_missing_nvidia_smi_is_remembered(monkeypatch):
    """Program yoksa BİR kez denenir, bir daha denenmez.

    Ölçüm aralığı saniyelerle ifade ediliyor: olmayan bir programı her turda
    başlatmaya çalışmak, GPU'su olmayan her makinede sürekli ve tamamen boş bir
    süreç yaratma maliyetidir.
    """
    run = FakeRun(error=FileNotFoundError("nvidia-smi yok"))
    monkeypatch.setattr(subprocess, "run", run)
    reader = GpuReader()

    assert reader.read_usage() == (None, None)
    assert reader.read_usage() == (None, None)
    assert reader.read_model() is None
    assert len(run.calls) == 1, "olmayan program tekrar tekrar çağrıldı"


def test_a_timeout_is_not_remembered(monkeypatch):
    """Geçici hata kalıcı sayılmaz — sürücü meşgulse sonraki tur yeniden dener."""
    run = FakeRun(error=subprocess.TimeoutExpired("nvidia-smi", 2.0))
    monkeypatch.setattr(subprocess, "run", run)
    reader = GpuReader()

    reader.read_usage()
    reader.read_usage()

    assert len(run.calls) == 2


def test_gpu_model_is_read_for_the_inventory(monkeypatch):
    run = FakeRun(stdout="NVIDIA GeForce RTX 4050 Laptop GPU\n")
    monkeypatch.setattr(subprocess, "run", run)

    assert GpuReader().read_model() == "NVIDIA GeForce RTX 4050 Laptop GPU"
    assert "--query-gpu=name" in run.calls[0]


def test_gpu_is_queried_on_every_collect(collector, monkeypatch):
    run = FakeRun(stdout="34, 2100\n")
    monkeypatch.setattr(subprocess, "run", run)

    sample = collector.collect().sample

    assert run.calls != []
    assert (sample.gpu_usage_percent, sample.gpu_vram_used_mb) == (34.0, 2100.0)


def test_gpu_model_enters_the_inventory(monkeypatch):
    monkeypatch.setattr(subprocess, "run", FakeRun(stdout="NVIDIA Test Card\n"))

    assert collect_inventory().gpu_model == "NVIDIA Test Card"


def test_inventory_without_a_gpu_has_no_model(monkeypatch):
    monkeypatch.setattr(subprocess, "run", FakeRun(error=FileNotFoundError()))

    assert collect_inventory().gpu_model is None


# --- config: eski enabled_addons satırı -------------------------------------


def test_a_leftover_enabled_addons_line_is_ignored_without_a_warning(tmp_path):
    """Eski kurulumun config.toml'unda kalan `enabled_addons` satırı agent'ı durdurmaz.

    Satır artık hiçbir şeyi etkilemez; ne hata ne uyarı üretmeli.
    """
    path = tmp_path / "config.toml"
    path.write_text(
        'collector_url = "https://collector.test"\n'
        'device_key = "tbx_live_test"\n'
        'enabled_addons = ["swap"]\n'
    )
    path.chmod(0o600)
    warnings = Warnings()

    ConfigLoader(path, warn=warnings).load()

    assert warnings == []
