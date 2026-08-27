"""
Seçilebilir eklentiler — enabled_addons filtresi, sensör seçimi ve GPU okuma.

Eklentilerin ortak riski şudur: **kapalıyken sessizce açık olmak ya da açıkken
sessizce yanlış şeyi ölçmek.** İkisi de hata üretmez; biri kullanıcının
istemediği veriyi toplar, diğeri sütuna makineden makineye farklı anlam taşıyan
bir sayı yazar.

Gerçek donanım burada kullanılamaz (bu makinede sensör olabilir, CI'da olmaz;
NVIDIA kartı olabilir, olmayabilir). Bu yüzden psutil ve nvidia-smi taklit
edilir: test edilen şey donanım değil, KARAR — hangi sensör seçiliyor, hangi
alan ne zaman dolduruluyor, hata nasıl yutuluyor.
"""

from __future__ import annotations

import subprocess
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace

import psutil
import pytest

import agent
from agent.core import metrics as metrics_module
from agent.core.config import (
    ADDON_EXTERNAL_IP,
    ADDON_GPU,
    ADDON_SWAP,
    ADDON_TEMPERATURE,
    KNOWN_ADDONS,
    Config,
    ConfigLoader,
)
from agent.core.gpu import GpuReader
from agent.core.inventory import collect_inventory
from agent.core.metrics import MetricsCollector

BARE = Config(collector_url="https://collector.test", device_key="tbx_live_test")
ALL_ADDONS = replace(BARE, enabled_addons=KNOWN_ADDONS)

# MetricSample'daki eklenti alanları — kapalıyken hepsi null kalmalı.
ADDON_FIELDS = (
    "temperature_c",
    "swap_used_mb",
    "load_avg_1",
    "load_avg_5",
    "load_avg_15",
    "gpu_usage_percent",
    "gpu_vram_used_mb",
)


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
    instance.collect(BARE)
    return instance


# --- enabled_addons filtresi ------------------------------------------------


def test_disabled_addons_leave_every_column_null(collector):
    """Varsayılan config'te eklenti alanlarının HEPSİ null olmalı.

    Bu testin koruduğu şey bir gizlilik/rıza kuralıdır: kullanıcı istemediği
    hiçbir ölçümü göndermemiş olmalı. Sızıntı sessizdir — sütun dolar, kimse
    fark etmez.
    """
    sample = asdict(collector.collect(BARE).sample)

    assert [field for field in ADDON_FIELDS if sample[field] is not None] == []


def test_enabling_an_addon_fills_only_its_own_columns(collector, monkeypatch):
    """Bir eklentiyi açmak diğerlerini açmaz.

    Tek bir `if` yanlış yazılırsa ("herhangi biri açıksa hepsini oku") kullanıcı
    swap isterken GPU'yu da göndermeye başlar.
    """
    monkeypatch.setattr(psutil, "swap_memory", lambda: SimpleNamespace(used=512 * 1024 * 1024))

    sample = asdict(collector.collect(replace(BARE, enabled_addons=(ADDON_SWAP,))).sample)

    assert sample["swap_used_mb"] == 512
    assert [field for field in ADDON_FIELDS if field != "swap_used_mb" and sample[field]] == []


def test_addon_list_is_read_from_the_config_on_every_collect(collector, monkeypatch):
    """Eklenti açmak servisi yeniden başlatmayı gerektirmez.

    Döngü config'i her tick okuyor; toplayıcı listeyi __init__'te
    saklasaydı kullanıcının config.toml'da yaptığı değişiklik ancak yeniden
    başlatmada geçerli olurdu.
    """
    monkeypatch.setattr(psutil, "swap_memory", lambda: SimpleNamespace(used=0))

    before = collector.collect(BARE).sample.swap_used_mb
    after = collector.collect(replace(BARE, enabled_addons=(ADDON_SWAP,))).sample.swap_used_mb

    assert before is None
    assert after == 0


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
    enabled = metrics_module._load_average(enabled=True)
    disabled = metrics_module._load_average(enabled=False)

    assert all(value is not None for value in enabled.values())
    assert all(value is None for value in disabled.values())


def test_load_average_failure_nulls_all_three(monkeypatch):
    """Platform desteklemiyorsa üçü birden null olur, ölçüm düşmez."""

    def explode():
        raise OSError("desteklenmiyor")

    monkeypatch.setattr(psutil, "getloadavg", explode, raising=False)

    assert metrics_module._load_average(enabled=True) == {
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


def test_gpu_is_not_queried_while_the_addon_is_off(collector, monkeypatch):
    """Eklenti kapalıyken nvidia-smi HİÇ çalıştırılmaz.

    Kapalı bir eklentinin bedeli sıfır olmalı; süreç başlatıp sonucu atmak
    "kapalı" demek değildir.
    """
    run = FakeRun(stdout="34, 2100\n")
    monkeypatch.setattr(subprocess, "run", run)

    collector.collect(BARE)

    assert run.calls == []


def test_gpu_model_enters_the_inventory_only_when_enabled(monkeypatch):
    monkeypatch.setattr(subprocess, "run", FakeRun(stdout="NVIDIA Test Card\n"))

    assert collect_inventory(BARE).gpu_model is None
    assert collect_inventory(replace(BARE, enabled_addons=(ADDON_GPU,))).gpu_model == (
        "NVIDIA Test Card"
    )


# --- external_ip: agent'ın göndermediği alan --------------------------------


def test_the_agent_never_reports_its_own_external_ip():
    """external_ip envanterde ALAN OLARAK YOK.

    Cihazın kendi dış IP'sini bildirmesi, doğruluğu cihazın insafına bırakırdı:
    bir agent istediği IP'yi yazabilirdi. Değeri, isteği gerçekten alan taraf
    (collector) bağlantının kaynağından yazar.

    Kullanıcının tercihi yine de agent'tan gider — enabled_addons listesiyle.
    """
    inventory = collect_inventory(ALL_ADDONS)

    assert "external_ip" not in asdict(inventory)
    # Tercih yine de gidiyor: collector'ın "yazayım mı" sorusunun cevabı burada.
    assert ADDON_EXTERNAL_IP in inventory.enabled_addons


# --- config: tanınmayan eklenti adı -----------------------------------------


def test_unknown_addon_name_warns_without_stopping_the_agent(tmp_path):
    """"temprature" yazan kullanıcı ne agent'ı kaybeder ne de sessiz kalır.

    Hata yükseltmek, tek harflik yazım hatası yüzünden izlemeyi tamamen
    durdururdu — izleme aracının yapabileceği en kötü şey.
    """
    path = tmp_path / "config.toml"
    path.write_text(
        'collector_url = "https://collector.test"\n'
        'device_key = "tbx_live_test"\n'
        'enabled_addons = ["temprature", "swap"]\n'
    )
    path.chmod(0o600)
    warnings = Warnings()

    config = ConfigLoader(path, warn=warnings).load()

    assert config.enabled_addons == ("temprature", "swap")
    assert len(warnings) == 1
    assert "temprature" in warnings[0]
    assert ADDON_TEMPERATURE in warnings[0], "uyarı doğru yazımı göstermiyor"


def test_every_known_addon_name_passes_without_a_warning(tmp_path):
    """Tanınan adların tamamı sessizce kabul edilmeli.

    Uyarı listesi bir adı yakalarsa, ya sabit listede ya da doğrulamada
    tutarsızlık var demektir.
    """
    path = tmp_path / "config.toml"
    names = ", ".join(f'"{name}"' for name in KNOWN_ADDONS)
    path.write_text(
        'collector_url = "https://collector.test"\n'
        'device_key = "tbx_live_test"\n'
        f"enabled_addons = [{names}]\n"
    )
    path.chmod(0o600)
    warnings = Warnings()

    ConfigLoader(path, warn=warnings).load()

    assert warnings == []


def test_the_example_config_lists_every_known_addon():
    """KNOWN_ADDONS ile config.example.toml aynı adları anmalı.

    Koda eklenip örnek dosyada anılmayan bir eklenti, kullanıcının varlığını
    hiç öğrenemeyeceği bir eklentidir; tersi (örnekte olup kodda olmayan) ise
    kurulumda uyarı basar.
    """
    body = (Path(agent.__file__).parent / "config.example.toml").read_text(encoding="utf-8")

    assert [name for name in KNOWN_ADDONS if f'"{name}"' not in body] == []
