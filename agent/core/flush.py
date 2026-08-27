"""
Acil gönderim — eşik aşıldığında 30 saniyelik gönderim turu beklenmez.

Modül iki soruyu cevaplar ve başka hiçbir şey yapmaz:
  * "şu an bir eşik aşıldı mı, aşıldıysa hangisi?" — evaluate()
  * "aşıldı ama çok yakın zamanda flush ettik mi?" — cooldown_active()

Gönderimin kendisi (spool'u boşaltmak, shipper'ı çağırmak, last_flush_at'i
yazmak) döngünün işidir; burada karar üretilir, yan etki üretilmez. Tek istisna
build_crash_snapshot(): süreç listesini okumak için psutil'e dokunur, ama o da
yalnızca okur.

CLAUDE.md §7 — eşikler cpu>90 / ram>90 / disk>95 ve error|critical seviyeli log.
"""

from __future__ import annotations

import time
import uuid

import psutil

from agent.core.clock import seconds_since_iso, utc_now_iso
from agent.core.config import ADDON_CRASH_PROCESSES, Config
from agent.core.metrics import BYTES_PER_MB, MetricSample

# crash_snapshots.trigger_reason'ın alabileceği dört değer. Şemadaki check
# kısıtı ve collector'daki Literal ile birebir aynı olmak zorunda.
REASON_LOG = "log"
REASON_RAM = "ram"
REASON_CPU = "cpu"
REASON_DISK = "disk"

# Aynı anda birden fazla eşik aşılabilir ama sütun tek değer alır. Sıralama
# yukarıdan aşağıya denenir ve ilk tutan yazılır: log en üstte, çünkü diğer üçü
# "yük yüksek" derken log "bir şey bozuldu" der.
REASON_ORDER = (REASON_LOG, REASON_RAM, REASON_CPU, REASON_DISK)

# Snapshot'a kaç süreç girer.
TOP_PROCESS_COUNT = 5

# Süreç başına CPU yüzdesi iki okuma arasındaki farktan hesaplanır; ilk okuma
# her süreç için 0.0 döner. Aradaki bu kısa bekleme olmadan liste tamamen
# sıfırlardan oluşur ve sıralama anlamsızlaşır.
PROCESS_SAMPLE_SECONDS = 0.1


def _above(value: float | None, threshold: int) -> bool:
    """Ölçüm eşiği aştı mı. Ölçülemeyen alan (None) eşiği aşmış sayılmaz."""
    return value is not None and value > threshold


def evaluate(
    *,
    sample: MetricSample,
    ram_percent: float | None,
    urgent_log_count: int,
    config: Config,
) -> str | None:
    """Eşik aşıldıysa trigger_reason'ı, aşılmadıysa None döndürür.

    ram_percent ölçümün yanında AYRICA taşınır: MetricSample doğrudan wire
    gövdesi olarak gidiyor ve collector sözleşme dışı alanı 422 ile reddediyor,
    yani yüzde o nesneye eklenemez. Yine de aynı ölçüm anına aittir — eşik
    kararı ile kaydedilen satır arasında zaman farkı olmaz.

    Sıra REASON_ORDER'dır; ilk tutan kazanır.
    """
    if urgent_log_count > 0:
        return REASON_LOG
    if _above(ram_percent, config.flush_ram_threshold):
        return REASON_RAM
    if _above(sample.cpu_percent, config.flush_cpu_threshold):
        return REASON_CPU
    if _above(sample.disk_percent, config.flush_disk_threshold):
        return REASON_DISK
    return None


def cooldown_active(last_flush_at: str | None, cooldown_seconds: int) -> bool:
    """Son flush'ın üzerinden cooldown süresi geçmediyse True.

    Ölçüm duvar saatiyle yapılır (monotonic ile değil): monotonic agent her
    yeniden başladığında sıfırlanır, o anda cooldown da sıfırlanırdı.

    İki durumda False döner, yani flush'a izin verilir:
      * damga yok ya da çözülemedi — daha önce hiç flush edilmemiş kabul edilir,
      * geçen süre NEGATİF — damga gelecekte kalmış, yani sistem saati geri
        alınmış. Bu durumda cooldown'ı açık saymak flush'ı süresiz kilitlerdi;
        izin verildiğinde damga yeniden yazılır ve hesap kendiliğinden düzelir.
    """
    elapsed = seconds_since_iso(last_flush_at)
    if elapsed is None or elapsed < 0:
        return False
    return elapsed < cooldown_seconds


def _top_processes(reason: str, limit: int) -> list[dict]:
    """En çok kaynak tüketen süreçleri {name, cpu, ram_mb} sözlükleri olarak verir.

    İki turlu okuma: ilk tur her sürecin CPU sayacına taban değeri koyar,
    PROCESS_SAMPLE_SECONDS kadar beklenir, ikinci tur o tabana göre gerçek
    yüzdeyi verir.

    Sıralama ölçütü tetikleyiciye göre değişir: RAM eşiği aşıldıysa belleğe,
    diğer hallerde CPU'ya bakılır — "kaynak-yiyen" ifadesinin karşılığı, o an
    tükenen kaynaktır. İkinci alan eşitlik bozucudur.

    Okuma sırasında ölen ya da izin vermeyen süreçler sessizce atlanır: snapshot
    tam olmasa da alınır, çünkü alındığı an bir daha gelmez.
    """
    for process in psutil.process_iter():
        try:
            process.cpu_percent()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    time.sleep(PROCESS_SAMPLE_SECONDS)

    rows: list[dict] = []
    for process in psutil.process_iter(["name", "memory_info"]):
        try:
            cpu = process.cpu_percent()
            info = process.info
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

        memory = info.get("memory_info")
        rows.append(
            {
                # name boş dönebilir (çekirdek thread'leri); sütun metin
                # bekliyor, boş metin yerine görünür bir işaret konur.
                "name": info.get("name") or "?",
                "cpu": round(cpu, 1),
                "ram_mb": memory.rss // BYTES_PER_MB if memory else 0,
            }
        )

    if reason == REASON_RAM:
        rows.sort(key=lambda row: (row["ram_mb"], row["cpu"]), reverse=True)
    else:
        rows.sort(key=lambda row: (row["cpu"], row["ram_mb"]), reverse=True)

    return rows[:limit]


def build_crash_snapshot(reason: str, config: Config) -> dict:
    """POST /ingest gövdesindeki crash_snapshots satırını üretir (CLAUDE.md §4.2).

    Satır HER flush'ta yazılır. crash_processes eklentisi kapalıysa processes
    boş kalır ama trigger_reason ile measured_at yine kaydedilir; metrikler
    "CPU %95'ti" der, bu satır "flush gerçekten attı" der.

    Süreçler okunamazsa (psutil beklenmedik bir hata verirse) snapshot boş
    süreç listesiyle döner: eksik bir kayıt, hiç kayıt olmamasından iyidir.
    """
    processes: list[dict] = []
    # Süreç listesi yalnızca eklenti açıkken doldurulur; kapalıyken satır
    # yine yazılır ama processes boş kalır.
    if ADDON_CRASH_PROCESSES in config.enabled_addons:
        try:
            processes = _top_processes(reason, TOP_PROCESS_COUNT)
        except psutil.Error:
            processes = []

    return {
        "uuid": str(uuid.uuid4()),
        "measured_at": utc_now_iso(),
        "trigger_reason": reason,
        "processes": processes,
    }
