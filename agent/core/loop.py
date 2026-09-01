"""
Kalp atışı — agent'ın tek ve sonsuz döngüsü.

Döngü TEK thread'dir: ikinci bir thread state.json'a ikinci bir
yazar eklerdi. Tüm işler tick sayaçlarıyla sıraya girer.

Tick sabit 1 saniyedir ve config'den okunmaz; collect/send/poll aralıkları
birbirinden bağımsız sayaçlardır.

M7 KAPSAMI: ölçümler ve sistem logları spool'a yazılıp collector'a gönderilir,
komutlar (pause/resume/delete) poll ile alınıp uygulanır, eşik aşıldığında
gönderim turu beklenmeden acil flush yapılır.
"""

from __future__ import annotations

import signal
import threading
import time
import uuid
from collections import Counter
from dataclasses import asdict

from agent import __version__
from agent.core import commands as commands_module
from agent.core import flush as flush_module
from agent.core import inventory as inventory_module
from agent.core.clock import utc_now_iso
from agent.core.commands import CommandError, CommandPoller
from agent.core.config import Config, ConfigLoader
from agent.core.inventory import Inventory
from agent.core.metrics import MetricReading, MetricSample, MetricsCollector
from agent.core.shipper import Shipper
from agent.core.spool import RECORD_CRASH, RECORD_LOG, RECORD_METRIC, Spool
from agent.core.state import State, StateStore
from agent.logsources.base import (
    LEVELS,
    URGENT_LEVELS,
    LogRecord,
    LogSource,
    LogSourceError,
)

# Döngünün nabzı. Config'e AÇILMAZ: ölçüm sıklığı (insan sınırı) ile döngü ritmi
# (sistem sabiti) ayrı kavramlardır.
TICK_SECONDS = 1

# Ölçülemeyen alanların ekrandaki karşılığı. Kayıtta bu alanlar null olur;
# 0 yazmak "yük yoktu" demek olurdu.
UNAVAILABLE = "—"


def _log(message: str) -> None:
    """Tek satırlık zaman damgalı çıktı.

    flush=True: systemd altında stdout bir boruya (pipe) bağlıdır ve tamponlanır;
    tamponlanan satırlar journalctl'de dakikalarca görünmez.
    """
    print(f"{utc_now_iso()} {message}", flush=True)


def _install_stop_signal() -> threading.Event:
    """SIGTERM/SIGINT geldiğinde kurulan olayı (event) döndürür.

    systemd durdurma isteğini SIGTERM ile gönderir. Sinyali yakalayıp döngüyü
    kendi turunun sonunda bitirmek, state yazmanın ortasında ölmeyi önler.
    """
    stop = threading.Event()

    def handle(signum, _frame) -> None:
        _log(f"[signal] {signal.Signals(signum).name} received, shutting down the loop.")
        stop.set()

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)
    return stop


def _format_sample(sample: MetricSample) -> str:
    """Ölçümü tek satırlık okunur bir özete çevirir."""

    def value(number, unit: str, digits: int = 1) -> str:
        return UNAVAILABLE if number is None else f"{number:.{digits}f}{unit}"

    return (
        f"cpu={value(sample.cpu_percent, '%')} "
        f"ram={sample.ram_used_mb}MB "
        f"disk={value(sample.disk_percent, '%')} "
        f"net↑{value(sample.net_sent_mb, 'MB/s', 3)} "
        f"net↓{value(sample.net_recv_mb, 'MB/s', 3)}"
    )


def _startup_inventory(config: Config, state: State) -> Inventory | None:
    """Envanteri okur; gönderilmesi gerekiyorsa onu döndürür, gerekmiyorsa None.

    Dönen değer gönderilene kadar bellekte bekler; `known_inventory` ancak
    collector'dan 200 alındıktan sonra yazılır.
    """
    current = inventory_module.collect_inventory(config)
    _log(
        f"[start] inventory: {current.os_name} {current.os_version} · "
        f"{current.cpu_model} · "
        f"{current.cpu_cores_physical}/{current.cpu_cores_logical} cores · "
        f"{current.ram_total_mb}MB RAM · {current.disk_total_mb}MB disk · "
        f"kernel {current.kernel_version} ({current.arch})"
    )
    _log(f"[start] booted at: {current.last_boot}")

    changed = inventory_module.changed_fields(current, state.known_inventory)
    if not changed:
        _log("[start] inventory unchanged — nothing to send.")
        return None

    reason = "read for the first time" if not state.known_inventory else "changed"
    _log(
        f"[start] inventory {reason}: {len(changed)} field(s) "
        f"({', '.join(sorted(changed))}) — will be sent"
    )
    return current


def _collect(collector: MetricsCollector, spool: Spool, config: Config) -> MetricReading:
    """Ölçüm alıp spool'a yazar ve okumayı geri döndürür.

    Pause'da da çalışır: pause yalnızca buluta göndermeyi durdurur, yerel kaydı
    değil.

    Spool'a yalnızca reading.sample yazılır; yanındaki ram_percent kaydedilmez,
    eşik karşılaştırmasını yapacak olan çağırana verilir.
    """
    reading = collector.collect(config)
    spool.add(RECORD_METRIC, asdict(reading.sample))
    _log(f"[collect] {_format_sample(reading.sample)}")
    return reading


def _log_payload(record: LogRecord) -> dict:
    """LogRecord'u POST /ingest gövdesindeki log satırına çevirir (CLAUDE.md §4.2).

    Çeviri okuyucuda değil BURADA yapılır: wire alanları (uuid, measured_at)
    taşımanın işidir, okumanın değil — LogRecord her kaynakta aynı sade şekli
    korur ([[decisions]] → "LogRecord saf kalır").

    uuid her okumada yeniden üretilir. Metinden türetilen deterministik bir
    kimlik cazip görünür (tekrar okunan log aynı id'yi alır, sunucu eler) ama
    aynı saniyede aynı metni yazan iki AYRI logu tek kimliğe indirirdi; sunucu
    birini tekrar sanıp atar, yani kayıp riskini tekrar riskiyle takas ederdik.
    """
    return {
        "uuid": str(uuid.uuid4()),
        "measured_at": record.timestamp,
        "level": record.level,
        "message": record.message,
        "source": record.source,
    }


def _level_summary(records: list[LogRecord]) -> str:
    """Okunan kayıtların seviye dağılımı — tek satırlık konsol özeti."""
    counts = Counter(record.level for record in records)
    return " ".join(f"{level}={counts[level]}" for level in LEVELS if counts[level])


def _collect_logs(source: LogSource, spool: Spool, state: State, store: StateStore) -> int:
    """Cursor'dan beri biriken logları okuyup spool'a yazar.

    Dönen değer, bu turda okunan error|critical kayıtların sayısıdır — acil
    gönderim kararını döngü buna bakarak verir (CLAUDE.md §7). Sayı BURADA
    üretilir çünkü kayıtlar yalnızca burada elde tutulur; spool'a yazıldıktan
    sonra hangisinin bu turda geldiğini ayırt etmenin ucuz bir yolu kalmaz.

    Pause'da da çalışır: metrik toplama gibi, log toplama da yerel kayıttır.

    SIRA ÖNEMLİDİR — önce kayıtlar spool'a, sonra cursor state'e yazılır. Ters
    sırada, iki işlem arasında düşen bir agent o logları bir daha hiç okuyamazdı.
    Bu sırada en kötü ihtimal birkaç logun tekrar okunmasıdır: kaybetmek yerine
    tekrarlamak, at-least-once'ın istediği yön.
    """
    try:
        records, cursor = source.read_since(state.journal_cursor)
    except LogSourceError as error:
        # Log kaynağı erişilemez diye metrik toplama ve gönderim durmaz;
        # tur log'suz sürer, sorun bir sonraki turda yeniden denenir.
        _log(f"[logs] could not read: {error}")
        return 0

    for record in records:
        spool.add(RECORD_LOG, _log_payload(record))

    if cursor != state.journal_cursor:
        state.journal_cursor = cursor
        store.save(state)

    if records:
        _log(f"[logs] {len(records)} record(s) ({_level_summary(records)})")

    return sum(1 for record in records if record.level in URGENT_LEVELS)


def _prune_acked(state: State, store: StateStore, acked: list[str]) -> None:
    """Onaylanan komut id'lerini state'ten düşer.

    "Listeyi boşalt" DEĞİL, "onaylananları çıkar": aradaki fark bugün görünmez
    (tek döngü var, gönderim sırasında yeni komut uygulanamaz) ama kural
    bugünden doğru yazılırsa ileride bozulmaz.
    """
    if not acked:
        return

    remaining = [value for value in state.applied_command_ids if value not in set(acked)]
    if remaining != state.applied_command_ids:
        state.applied_command_ids = remaining
        store.save(state)


def _poll_commands(
    poller: CommandPoller,
    config: Config,
    state: State,
    store: StateStore,
    spool: Spool,
    shipper: Shipper,
) -> bool:
    """Komutları sorar, uygular ve ack'ler. Cihaz silindiyse True döner.

    Pause'da da çalışır; durmasaydı resume ve delete komutları cihaza hiç
    ulaşamazdı — duraklatılmış bir agent'ı geri açmanın başka yolu kalmazdı.
    """
    try:
        commands = poller.fetch(config)
    except CommandError as error:
        # Komut alınamaması toplamayı ve gönderimi durdurmaz; tur komutsuz
        # geçer, sorun bir sonraki poll'da yeniden denenir.
        _log(f"[poll] could not fetch commands: {error}")
        return False

    if not commands:
        return False

    _log(f"[poll] {len(commands)} komut: {', '.join(command.type for command in commands)}")

    result = commands_module.apply_commands(
        commands,
        config=config,
        state=state,
        store=store,
        spool=spool,
        shipper=shipper,
        log=_log,
    )

    if result.deleted:
        return True

    # Zaten listede olan id yeniden eklenmez; ack denemesi yine de yapılır,
    # çünkü sunucu ack'i görene kadar aynı komutu vermeye devam eder.
    new_ids = [value for value in result.applied_ids if value not in state.applied_command_ids]
    if new_ids:
        state.applied_command_ids.extend(new_ids)

    if result.state_changed or new_ids:
        store.save(state)

    _prune_acked(
        state,
        store,
        commands_module.ack_now(result.applied_ids, config=config, shipper=shipper, log=_log),
    )
    return False


def _send_inventory(
    shipper: Shipper, config: Config, state: State, store: StateStore, pending: Inventory
) -> Inventory | None:
    """Envanteri gönderir; 200 alınırsa state'e işler ve None döndürür."""
    result = shipper.send_inventory(config, pending.as_dict())
    if not result.ok:
        _log(f"[send] could not send inventory: {result.detail}")
        return pending

    state.known_inventory = pending.as_dict()
    store.save(state)
    _log("[send] inventory sent.")
    return None


def _send_spool(
    shipper: Shipper, config: Config, state: State, store: StateStore, spool: Spool
) -> None:
    """Spool'u gönderir; başarılıysa last_send'i günceller."""
    result = shipper.send_pending(config, state.applied_command_ids)

    # Onaylanan ack'ler gönderim yarıda kalsa bile düşer: ilk istek 200 almış
    # olabilir, o id'ler artık sunucuda `applied`.
    _prune_acked(state, store, result.acked)

    if not result.ok:
        _log(
            f"[send] failed: {result.detail} — {spool.count()} record(s) waiting, "
            f"retrying in {shipper.backoff_seconds:.0f}s."
        )
        return

    if result.sent:
        state.last_send = utc_now_iso()
        store.save(state)

    _log(f"[send] {result.sent} record(s) sent (spool: {spool.count()}).")


def _maybe_flush(
    reading: MetricReading,
    urgent_log_count: int,
    config: Config,
    state: State,
    store: StateStore,
    spool: Spool,
    shipper: Shipper,
) -> bool:
    """Eşik aşıldıysa acil gönderim yapar. Gönderim yapıldıysa True döner.

    Pause kapısı BURADADIR, çağıranda değil: acil gönderim de "buluta
    yükleme"dir ve pause bunu durdurur (CLAUDE.md §7). Kural, yüklemeyi yapan
    fonksiyonun içinde durursa yeni bir çağıran eklendiğinde unutulamaz.
    Komut poll'ünün aksine burada istisna yoktur — flush telemetridir,
    teardown kontrol mesajı değil.

    Pause'da eşiğe hiç bakılmaz: ölçüm ve loglar spool'a yazılmaya devam eder,
    resume anında hepsi çıkar. crash_snapshots satırı da yazılmaz, çünkü o
    satırın anlamı "flush attı"dır — atmadığı bir anda yazılsa yalan söylerdi.
    """
    if not state.logging_enabled:
        return False

    reason = flush_module.evaluate(
        sample=reading.sample,
        ram_percent=reading.ram_percent,
        urgent_log_count=urgent_log_count,
        config=config,
    )
    if reason is None:
        return False

    if flush_module.cooldown_active(state.last_flush_at, config.flush_cooldown_seconds):
        # Veri kaybolmaz: eşiği aşan ölçüm de, tetikleyen log da spool'da
        # duruyor ve normal gönderim turunda çıkacak. Bastırılan tek şey
        # ACELE etmek — cooldown'ın amacı zaten flush selini önlemek.
        _log(f"[flush] {reason} threshold exceeded, cooldown active — skipped.")
        return False

    # SIRA ÖNEMLİDİR: snapshot önce spool'a yazılır, sonra gönderim yapılır.
    # Ters sırada snapshot bir sonraki tura kalır ve kendisini tetikleyen
    # ölçümden ayrı bir istekte giderdi.
    spool.add(RECORD_CRASH, flush_module.build_crash_snapshot(reason, config))

    # Damga gönderimden ÖNCE yazılır: gönderim başarısız olsa bile cooldown
    # başlamış sayılır. Aksi halde collector erişilemezken eşik her turda
    # yeniden tutar, her tur yeni bir snapshot üretilir ve spool kesintinin
    # sürdüğü süre boyunca boş yere şişerdi.
    state.last_flush_at = utc_now_iso()
    store.save(state)

    if not shipper.ready():
        _log(
            f"[flush] {reason} threshold exceeded — backoff active, "
            f"sending in {shipper.backoff_seconds:.0f}s."
        )
        return False

    _log(f"[flush] {reason} threshold exceeded — emergency ship.")
    _send_spool(shipper, config, state, store, spool)
    return True


def run(loader: ConfigLoader, store: StateStore, log_source: LogSource) -> None:
    """Agent'ı açılıştan kapanışa kadar çalıştırır.

    log_source DIŞARIDAN verilir. Hangi işletim sisteminde çalışıldığı bilgisi
    giriş noktasının (__main__) işidir; döngü yalnızca LogSource arayüzünü
    tanır ve journald'ı hiç import etmez (CLAUDE.md §7).
    """
    # --- AÇILIŞ (bir kez) ---
    config = loader.load()
    state = store.load()
    stop = _install_stop_signal()
    collector = MetricsCollector()
    spool = Spool(
        store.directory,
        max_age_days=config.spool_max_age_days,
        max_size_mb=config.spool_max_size_mb,
    )
    shipper = Shipper(spool)
    poller = CommandPoller()

    _log(f"[start] TraceBox agent {__version__}")
    _log(f"[start] config: {loader.path}")
    _log(f"[start] state:  {store.path}")
    _log(f"[start] spool:  {spool.path} ({spool.count()} record(s) waiting)")
    _log(f"[start] target: {config.collector_url}")
    _log(
        "[start] intervals: "
        f"collect={config.collect_interval_seconds}s "
        f"send={config.send_interval_seconds}s "
        f"poll={config.command_poll_seconds}s (tick={TICK_SECONDS}s)"
    )
    _log(f"[start] logging_enabled={state.logging_enabled}")
    _log(
        "[start] add-ons: "
        + (", ".join(config.enabled_addons) if config.enabled_addons else "none (core only)")
    )
    _log(
        "[start] journal cursor: "
        + ("stored — resuming" if state.journal_cursor else "none — starting from now")
    )
    pending_inventory = _startup_inventory(config, state)

    # --- SAYAÇLAR ---
    # Her sayaç kendi "sıradaki çalışma anını" tutar. Karşılaştırmalar
    # monotonic saatle yapılır: sistem saati değişse bile döngü kilitlenmez.
    now = time.monotonic()
    next_collect = now  # ilk ölçüm beklemeden alınır
    next_poll = now + config.command_poll_seconds
    next_send = now + config.send_interval_seconds

    # --- KALP ATIŞI ---
    deleted = False
    try:
        while not stop.is_set():
            now = time.monotonic()

            # Config her turda yeniden okunur; dosya değişmediyse önbellekten
            # gelir. Aralık değişikliği bir sonraki sayaç kurulumunda geçerli olur.
            config = loader.load()

            if now >= next_collect:
                reading = _collect(collector, spool, config)
                urgent_logs = _collect_logs(log_source, spool, state, store)
                next_collect = now + config.collect_interval_seconds

                # Eşik ölçümün HEMEN ardından değerlendirilir: tetikleyen örnek
                # ve loglar spool'a yeni yazıldı, yani acil gönderim onları da
                # götürür. Pause denetimi _maybe_flush'ın içindedir.
                # Flush gerçekten gönderdiyse normal gönderim sayacı ileri
                # alınır — az önce boşalan spool'u saniyeler sonra bir kez daha
                # yoklamanın anlamı yok.
                if _maybe_flush(reading, urgent_logs, config, state, store, spool, shipper):
                    next_send = now + config.send_interval_seconds

            if now >= next_poll:
                if _poll_commands(poller, config, state, store, spool, shipper):
                    # delete uygulandı: cihaz kaydı sunucudan silindi, yerel
                    # veri temizlendi. Toplamaya devam etmenin anlamı yok.
                    deleted = True
                    break
                next_poll = now + config.command_poll_seconds

            # Aşağısı yalnızca gönderim açıkken çalışır. Pause sırasında
            # next_send ileri ALINMAZ: süresi geçmiş halde bekler, böylece
            # resume anında birikmiş veri ilk turda çıkar. Backoff sırasında da
            # aynı şekilde beklenir — süre dolunca ilk tick gönderimi yapar.
            if state.logging_enabled and now >= next_send and shipper.ready():
                if pending_inventory is not None:
                    pending_inventory = _send_inventory(
                        shipper, config, state, store, pending_inventory
                    )

                _send_spool(shipper, config, state, store, spool)
                next_send = now + config.send_interval_seconds

            # sleep yerine wait: sinyal geldiğinde tick'in bitmesini beklemeden
            # uyanır, kapanma anında hissedilir gecikme olmaz.
            stop.wait(TICK_SECONDS)
    finally:
        # --- KAPANIŞ ---
        # Durum diskte zaten günceldir (her save anında yazıldı); burada yalnızca
        # açık dosya ve bağlantılar kapatılır.
        poller.close()
        shipper.close()
        spool.close()

        if deleted:
            _log("[stop] host deleted — agent stopping, systemd will not restart it.")
        else:
            _log("[stop] loop stopped.")
