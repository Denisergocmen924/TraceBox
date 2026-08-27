"""
agent/core/flush.py + loop._maybe_flush — acil gönderim.

Buradaki soruların ortak yanı **sessiz** olmalarıdır: eşik yanlış bağlanırsa,
cooldown yanlış tarafa kayarsa ya da pause'da flush atarsa hiçbir hata mesajı
çıkmaz. Agent çalışmaya devam eder; yalnızca çöküş anındaki veri ya hiç gelmez
ya da gereksiz yere sel olur.

Testler üç katmanı ayırır:
  * evaluate()            — eşik kararı,
  * cooldown_active()     — sel koruması,
  * build_crash_snapshot()— wire satırı,
  * loop._maybe_flush()   — bunların döngüdeki sırası ve yan etkileri.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Literal, get_args, get_origin

import psutil
import pytest

from agent.core import flush, loop
from agent.core.clock import utc_now_iso
from agent.core.config import ADDON_CRASH_PROCESSES, Config
from agent.core.metrics import MetricReading, MetricSample
from agent.core.shipper import SendResult
from agent.core.spool import RECORD_CRASH, Spool
from agent.core.state import StateStore
from agent.logsources.base import LogRecord, LogSourceError

CONFIG = Config(collector_url="https://collector.test", device_key="tbx_live_test")


def make_reading(
    *,
    cpu: float | None = 1.0,
    ram_percent: float | None = 10.0,
    disk: float | None = 1.0,
    ram_used_mb: int = 100,
) -> MetricReading:
    """Eşiklerin ÇOK ALTINDA bir ölçüm; test yalnızca ilgilendiği alanı yükseltir."""
    sample = MetricSample(
        uuid=str(uuid.uuid4()),
        measured_at=utc_now_iso(),
        cpu_percent=cpu,
        ram_used_mb=ram_used_mb,
        disk_percent=disk,
        net_sent_mb=0.0,
        net_recv_mb=0.0,
    )
    return MetricReading(sample=sample, ram_percent=ram_percent)


def evaluate(reading: MetricReading, *, urgent: int = 0, config: Config = CONFIG) -> str | None:
    return flush.evaluate(
        sample=reading.sample,
        ram_percent=reading.ram_percent,
        urgent_log_count=urgent,
        config=config,
    )


def iso_seconds_ago(seconds: float) -> str:
    """`seconds` saniye önceki anın ISO damgası (negatif değer geleceği verir)."""
    moment = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    return moment.isoformat(timespec="seconds")


class FakeShipper:
    """`send_pending` çağrılarını sayar; hazır olma ve sonuç testten verilir."""

    def __init__(self, *, ready: bool = True, ok: bool = True) -> None:
        self._ready = ready
        self._ok = ok
        self.backoff_seconds = 0.0 if ready else 30.0
        self.calls: list[list[str]] = []

    def ready(self) -> bool:
        return self._ready

    def send_pending(self, config, applied_command_ids: list[str]) -> SendResult:
        self.calls.append(list(applied_command_ids))
        return SendResult(ok=self._ok, sent=1, detail="" if self._ok else "HTTP 500")


class FakeLogSource:
    """Verilen kayıtları bir kez döndürür; ikinci okumada boş gelir."""

    def __init__(self, *records: LogRecord, error: Exception | None = None) -> None:
        self._records = list(records)
        self._error = error

    def read_since(self, cursor):
        if self._error is not None:
            raise self._error
        records, self._records = self._records, []
        return records, "cursor-2"


def log_record(level: str) -> LogRecord:
    return LogRecord(timestamp=utc_now_iso(), level=level, message=f"{level} mesajı")


class FakeProcess:
    """psutil.Process'in _top_processes'in dokunduğu yüzeyi kadarı."""

    def __init__(self, name: str, cpu: float, ram_mb: int, error: Exception | None = None) -> None:
        self._name = name
        self._cpu = cpu
        self._ram_mb = ram_mb
        self._error = error

    def cpu_percent(self) -> float:
        if self._error is not None:
            raise self._error
        return self._cpu

    @property
    def info(self) -> dict:
        return {"name": self._name, "memory_info": SimpleNamespace(rss=self._ram_mb * 1024 * 1024)}


@pytest.fixture
def spool(tmp_path):
    instance = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    yield instance
    instance.close()


@pytest.fixture
def store(tmp_path):
    return StateStore(tmp_path)


@pytest.fixture
def fake_processes(monkeypatch):
    """psutil.process_iter'ı verilen listeyle değiştirir ve beklemeyi sıfırlar."""

    def install(processes: list[FakeProcess]) -> None:
        monkeypatch.setattr(psutil, "process_iter", lambda attrs=None: iter(processes))
        # Gerçek örnekleme aralığı testte yalnızca beklemeye yol açar.
        monkeypatch.setattr(flush, "PROCESS_SAMPLE_SECONDS", 0)

    return install


# --- evaluate: eşik kararı -------------------------------------------------


def test_quiet_machine_does_not_flush():
    """Hiçbir eşik tutmuyorsa acil gönderim yok — normal tur yeterli."""
    assert evaluate(make_reading()) is None


def test_threshold_must_be_exceeded_not_merely_reached():
    """Eşik `>` ile karşılaştırılır, `>=` ile değil.

    Fark tek bir kıyaslama işaretidir ama sonucu büyüktür: disk eşiği 95'te
    sabit duran bir makine `>=` ile her ölçümde flush ederdi ve cooldown
    dolduğu her an yeniden — "acil" kavramı sürekli hale gelirdi.
    """
    assert evaluate(make_reading(cpu=90.0)) is None
    assert evaluate(make_reading(cpu=90.1)) == flush.REASON_CPU


def test_unmeasurable_field_never_crosses_a_threshold():
    """None "ölçülemedi" demektir; eşiği aşmış sayılmaz.

    İlk ölçümde cpu_percent bilerek None döner (metrics.py). None'ı eşikle
    karşılaştırmaya çalışan bir kod TypeError ile döngüyü düşürürdü; sessizce
    "aşıldı" sayan bir kod ise her agent açılışında bir flush üretirdi.
    """
    assert evaluate(make_reading(cpu=None, ram_percent=None, disk=None)) is None


def test_ram_threshold_reads_the_percentage_not_the_megabytes():
    """Eşik yüzdedir; kayda giren ram_used_mb ile karıştırılamaz.

    Bu yüzden collect() ikisini birden döndürüyor. Yanlış alana bağlanırsa
    16 GB RAM'li bir makinede ram_used_mb neredeyse her zaman 90'ın üstünde
    olur ve agent durmadan flush eder.
    """
    assert evaluate(make_reading(ram_percent=10.0, ram_used_mb=15000)) is None
    assert evaluate(make_reading(ram_percent=95.0, ram_used_mb=100)) == flush.REASON_RAM


def test_urgent_log_alone_triggers_a_flush():
    """error|critical log, yük normalken bile acil gönderim sebebidir.

    Projenin vaadi bu: kritik log 30 saniyelik turu beklemez.
    """
    assert evaluate(make_reading(), urgent=1) == flush.REASON_LOG


def test_reason_priority_is_log_then_ram_then_cpu_then_disk():
    """Hepsi aynı anda tutabilir ama sütun tek değer alır.

    Sıra keyfi değil: log "bir şey bozuldu" der, diğer üçü yalnızca "yük
    yüksek" der. Yanlış sıra, çöküş sonrası bakılan satırda daha az bilgi
    taşıyan sebebi gösterir.
    """
    everything = make_reading(cpu=99.0, ram_percent=99.0, disk=99.0)

    assert evaluate(everything, urgent=1) == flush.REASON_LOG
    assert evaluate(everything) == flush.REASON_RAM
    assert evaluate(make_reading(cpu=99.0, disk=99.0)) == flush.REASON_CPU
    assert evaluate(make_reading(disk=99.0)) == flush.REASON_DISK


def test_thresholds_come_from_the_config_not_from_constants():
    """Eşikler config'ten okunur — kullanıcı kendi sınırını koyabilir."""
    strict = replace(CONFIG, flush_cpu_threshold=10)

    assert evaluate(make_reading(cpu=50.0)) is None
    assert evaluate(make_reading(cpu=50.0), config=strict) == flush.REASON_CPU


# --- cooldown: sel koruması ------------------------------------------------


def test_first_flush_is_never_blocked():
    """Damga yoksa daha önce hiç flush edilmemiştir; cooldown kapalıdır."""
    assert flush.cooldown_active(None, 20) is False


def test_unreadable_stamp_does_not_block_the_flush():
    """state.json elle bozulmuşsa flush kilitlenmez.

    Okunamayan bir damga "çok yakın zamanda flush ettik" anlamına gelemez;
    aksi yönde yorumlanırsa tek bir bozuk satır acil gönderimi kalıcı olarak
    kapatırdı.
    """
    assert flush.cooldown_active("dün", 20) is False


def test_recent_flush_blocks_the_next_one():
    assert flush.cooldown_active(iso_seconds_ago(5), 20) is True


def test_cooldown_expires():
    assert flush.cooldown_active(iso_seconds_ago(25), 20) is False


def test_a_stamp_from_the_future_does_not_lock_the_flush_forever():
    """Sistem saati geri alındıysa damga gelecekte kalır.

    Geçen süre negatif çıkar. "Süre dolmadı" sayılırsa cooldown saat farkı
    kadar — saatlerce, günlerce — açık kalır ve acil gönderim tamamen durur.
    O yüzden negatif fark, cooldown'ın kapalı olması demektir.
    """
    assert flush.cooldown_active(iso_seconds_ago(-3600), 20) is False


# --- build_crash_snapshot: wire satırı -------------------------------------


def test_snapshot_is_written_even_when_the_addon_is_off():
    """crash_processes kapalıyken (varsayılan) satır yine yazılır, süreçler boş.

    Metrikler "CPU %95'ti" der; bu satır "flush GERÇEKTEN attı" der. İkisi
    farklı sorulardır — satır atlanırsa acil gönderimin çalıştığına dair tek
    kanıt kaybolur.
    """
    snapshot = flush.build_crash_snapshot(flush.REASON_CPU, CONFIG)

    assert snapshot["processes"] == []
    assert snapshot["trigger_reason"] == flush.REASON_CPU
    assert snapshot["measured_at"]
    assert uuid.UUID(snapshot["uuid"])


def test_snapshot_carries_processes_when_the_addon_is_on(fake_processes):
    """Eklenti açıkken en çok kaynak yiyen süreçler listelenir."""
    fake_processes([FakeProcess(f"p{index}", cpu=float(index), ram_mb=index) for index in range(9)])
    config = replace(CONFIG, enabled_addons=(ADDON_CRASH_PROCESSES,))

    snapshot = flush.build_crash_snapshot(flush.REASON_CPU, config)

    assert len(snapshot["processes"]) == flush.TOP_PROCESS_COUNT
    assert [row["name"] for row in snapshot["processes"]] == ["p8", "p7", "p6", "p5", "p4"]
    assert snapshot["processes"][0] == {"name": "p8", "cpu": 8.0, "ram_mb": 8}


def test_ram_triggered_snapshot_ranks_by_memory(fake_processes):
    """Sıralama ölçütü, o an TÜKENEN kaynaktır.

    RAM eşiği aştığında CPU'ya göre sıralanmış bir liste yanlış beş süreci
    gösterir — belleği bitiren süreç listede hiç görünmeyebilir.
    """
    fake_processes(
        [
            FakeProcess("cpu-yiyen", cpu=99.0, ram_mb=1),
            FakeProcess("ram-yiyen", cpu=0.1, ram_mb=8000),
        ]
    )
    config = replace(CONFIG, enabled_addons=(ADDON_CRASH_PROCESSES,))

    by_ram = flush.build_crash_snapshot(flush.REASON_RAM, config)
    by_cpu = flush.build_crash_snapshot(flush.REASON_CPU, config)

    assert [row["name"] for row in by_ram["processes"]] == ["ram-yiyen", "cpu-yiyen"]
    assert [row["name"] for row in by_cpu["processes"]] == ["cpu-yiyen", "ram-yiyen"]


def test_processes_that_vanish_mid_read_are_skipped(fake_processes):
    """Okuma sırasında ölen ya da izin vermeyen süreç snapshot'ı düşürmez.

    Eksik bir snapshot, hiç snapshot olmamasından iyidir: o an bir daha gelmez.
    """
    fake_processes(
        [
            FakeProcess("ölen", cpu=99.0, ram_mb=10, error=psutil.NoSuchProcess(pid=1)),
            FakeProcess("kapalı", cpu=98.0, ram_mb=10, error=psutil.AccessDenied()),
            FakeProcess("sağlam", cpu=5.0, ram_mb=10),
        ]
    )
    config = replace(CONFIG, enabled_addons=(ADDON_CRASH_PROCESSES,))

    snapshot = flush.build_crash_snapshot(flush.REASON_CPU, config)

    assert [row["name"] for row in snapshot["processes"]] == ["sağlam"]


def test_psutil_failure_leaves_the_snapshot_without_processes(monkeypatch):
    """psutil beklenmedik bir hata verirse snapshot yine üretilir.

    Süreç listesi bir EKLENTİdir; onun hatası acil gönderimin kaydını
    engellememeli.
    """
    monkeypatch.setattr(flush, "_top_processes", _raise_psutil_error)
    config = replace(CONFIG, enabled_addons=(ADDON_CRASH_PROCESSES,))

    snapshot = flush.build_crash_snapshot(flush.REASON_RAM, config)

    assert snapshot["processes"] == []
    assert snapshot["trigger_reason"] == flush.REASON_RAM


def _raise_psutil_error(reason, limit):
    raise psutil.Error()


def test_reasons_match_the_collectors_contract():
    """flush.py'nin ürettiği her sebep collector'ın kabul ettiği kümede olmalı.

    İki dosya birbirini import etmiyor; sözleşme yalnızca CLAUDE.md §4.2'de
    yazılı. Buraya yeni bir sebep eklenip collector'daki Literal'a
    eklenmezse agent 422 alır ve o snapshot HİÇ kaydedilmez — üstelik
    yalnızca gerçek bir çöküş anında, yani test edilmesi en zor anda.
    """
    from collector.endpoints_ingest import CrashSnapshotIn

    annotation = CrashSnapshotIn.model_fields["trigger_reason"].annotation
    literal = next(arg for arg in get_args(annotation) if get_origin(arg) is Literal)

    assert set(flush.REASON_ORDER) == set(get_args(literal))


# --- loop._maybe_flush: döngüdeki sıra ve yan etkiler ----------------------


def test_collect_logs_counts_only_the_urgent_levels(store, spool):
    """_collect_logs, flush'ın girdisini üretir: bu turda kaç acil log geldi.

    Sayı yalnızca okuma anında bilinebilir — kayıtlar spool'a karıştıktan sonra
    hangisinin bu turda geldiğini ayırt etmenin ucuz yolu yok. Sayım info ve
    warning'i de katarsa agent her sıradan log satırında flush eder; hiç
    saymazsa "kritik log 30 saniye beklemez" vaadi sessizce çöker.
    """
    source = FakeLogSource(
        log_record("info"),
        log_record("warning"),
        log_record("error"),
        log_record("critical"),
    )

    urgent = loop._collect_logs(source, spool, store.load(), store)

    assert urgent == 2
    assert spool.count() == 4, "acil olmayan loglar da spool'a yazılmalı"


def test_unreadable_log_source_reports_no_urgent_records(store, spool):
    """Log okunamadıysa acil log sayısı sıfırdır — flush uydurulmaz."""
    source = FakeLogSource(error=LogSourceError("journalctl yok"))

    assert loop._collect_logs(source, spool, store.load(), store) == 0


def maybe_flush(reading, store, spool, shipper, *, urgent: int = 0, config: Config = CONFIG):
    state = store.load()
    sent = loop._maybe_flush(reading, urgent, config, state, store, spool, shipper)
    return sent, state


def crash_records(spool: Spool) -> list[dict]:
    return [record.payload for record in spool.take(100) if record.type == RECORD_CRASH]


def test_crossing_a_threshold_sends_without_waiting_for_the_send_interval(store, spool):
    """Projenin ana vaadinin kod karşılığı: veri 30 saniyeyi beklemez."""
    shipper = FakeShipper()

    sent, state = maybe_flush(make_reading(cpu=99.0), store, spool, shipper)

    assert sent is True
    assert len(shipper.calls) == 1, "acil gönderim yapılmadı"
    assert crash_records(spool)[0]["trigger_reason"] == flush.REASON_CPU
    assert state.last_flush_at, "cooldown damgası yazılmadı"
    # Damganın DİSKE yazıldığı burada kanıtlanamaz: başarılı gönderim zaten
    # last_send için state'i kaydediyor, yani iddia yanlışlıkla tatmin olurdu.
    # Kalıcılığın tek gerçek kanıtı gönderimin yapılmadığı yollardadır —
    # test_backoff_records_the_snapshot_but_does_not_send ve
    # test_failed_send_still_starts_the_cooldown.


def test_quiet_tick_touches_nothing(store, spool):
    """Eşik tutmuyorsa ne snapshot ne gönderim ne damga."""
    shipper = FakeShipper()

    sent, state = maybe_flush(make_reading(), store, spool, shipper)

    assert sent is False
    assert shipper.calls == []
    assert spool.count() == 0
    assert state.last_flush_at is None


def test_urgent_log_reaches_the_loop(store, spool):
    """_collect_logs'un saydığı acil log, döngüde gerçekten flush'a dönüşür."""
    shipper = FakeShipper()

    sent, _ = maybe_flush(make_reading(), store, spool, shipper, urgent=1)

    assert sent is True
    assert crash_records(spool)[0]["trigger_reason"] == flush.REASON_LOG


def test_cooldown_suppresses_both_the_snapshot_and_the_send(store, spool):
    """Cooldown içindeyken hiçbir yan etki olmaz.

    Veri kaybolmuyor: eşiği aşan ölçüm ve loglar spool'da duruyor, normal
    gönderim turunda çıkacak. Bastırılan tek şey ACELE etmek.
    """
    state = store.load()
    state.last_flush_at = iso_seconds_ago(1)
    store.save(state)
    shipper = FakeShipper()

    sent, _ = maybe_flush(make_reading(cpu=99.0), store, spool, shipper)

    assert sent is False
    assert shipper.calls == []
    assert crash_records(spool) == []
    assert store.load().last_flush_at == state.last_flush_at, "damga tazelendi"


def test_paused_agent_never_flushes(store, spool):
    """Pause = buluta yükleme yok. Acil gönderim de bir yüklemedir.

    Komut poll'ünün aksine bunun istisnası yok: flush telemetridir, teardown
    kontrol mesajı değil. Snapshot da yazılmaz — o satırın anlamı "flush
    attı"dır, atmadığı bir anda yazılsa yalan söylerdi.
    """
    state = store.load()
    state.logging_enabled = False
    store.save(state)
    shipper = FakeShipper()

    sent, _ = maybe_flush(make_reading(cpu=99.0), store, spool, shipper)

    assert sent is False
    assert shipper.calls == []
    assert crash_records(spool) == []
    assert store.load().last_flush_at is None


def test_backoff_records_the_snapshot_but_does_not_send(store, spool):
    """Collector erişilemezken snapshot yine alınır, gönderim ertelenir.

    Damga da yazılır: yazılmasaydı kesinti boyunca eşik her turda yeniden
    tutar, her tur yeni bir snapshot üretilir ve spool boş yere şişerdi.
    """
    shipper = FakeShipper(ready=False)

    sent, _ = maybe_flush(make_reading(cpu=99.0), store, spool, shipper)

    assert sent is False, "backoff sürerken gönderim denenmemeli"
    assert shipper.calls == []
    assert len(crash_records(spool)) == 1
    assert store.load().last_flush_at is not None


def test_failed_send_still_starts_the_cooldown(store, spool):
    """Gönderim 500 alsa bile cooldown başlar.

    Aksi halde sunucu hata verdiği sürece her ölçüm turu yeni bir acil
    gönderim denemesi üretir — hatanın üstüne yük binerdi.
    """
    shipper = FakeShipper(ok=False)

    sent, _ = maybe_flush(make_reading(cpu=99.0), store, spool, shipper)

    assert len(shipper.calls) == 1
    assert sent is True, "gönderim denendi — sayaç ileri alınmalı"
    assert store.load().last_flush_at is not None


def test_snapshot_enters_the_spool_before_the_send(store, spool):
    """Snapshot, kendisini tetikleyen veriyle AYNI istekte gitmelidir.

    Ters sırada yazılsaydı bir sonraki tura kalır ve çöküş anının kaydı,
    çöküşü anlatan metriklerden ayrı düşerdi.
    """
    seen: list[int] = []
    shipper = FakeShipper()
    original = shipper.send_pending

    def record_then_send(config, applied_command_ids):
        seen.append(len(crash_records(spool)))
        return original(config, applied_command_ids)

    shipper.send_pending = record_then_send

    maybe_flush(make_reading(disk=99.0), store, spool, shipper)

    assert seen == [1], "gönderim anında snapshot henüz spool'da değildi"
