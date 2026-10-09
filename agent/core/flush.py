"""
Acil gönderim — eşik aşıldığında 10 saniyelik gönderim turu beklenmez.

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

import re
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

import psutil

from agent.core.clock import seconds_since_iso, utc_now_iso
from agent.core.config import ADDON_CRASH_PROCESSES, Config
from agent.core.metrics import BYTES_PER_MB, MetricSample
from agent.logsources.base import LogRecord

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


# Disk çıpası eşiğin bu kadar puan altına inince silinir (histerezis). Eşiğin
# tam üstünde-altında gidip gelen bir disk her geçişte yeniden "ilk aşım" sayılıp
# flush ederdi; 1 puanlık pay bunu keser. Config'e AÇILMAZ: kullanıcının ayarı
# adımdır, pay sistemin sabitidir.
DISK_REARM_MARGIN = 1.0

# Yüzde kayan noktalı olduğu için "çıpa + adım" karşılaştırması 0.1 gibi
# değerlerde bir ulp yüzünden yanlış tarafa düşebilir.
_EPSILON = 1e-9

# Aynı hatanın tekrar flush edebilmesi için gereken SESSİZLİK. Her tekrar
# sessizlik sayacını sıfırlar: saniyede yüz kez tekrarlayan bir hata döngüsü
# süresiz olarak tek flush üretir, 30 saniye susup yeniden başlayan ise yenisini.
LOG_SILENCE_SECONDS = 30.0

# Bellekteki parmak izi tablosunun üst sınırı. Sınırsız büyürse her seferinde
# farklı metin üreten bir hata döngüsü agent'ın belleğini şişirirdi.
_MAX_FINGERPRINTS = 1000

_UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_HEX_PREFIXED = re.compile(r"\b0[xX][0-9a-fA-F]+\b")
# En az bir rakam şartı: "decaffed" gibi yalnızca a-f harflerinden oluşan sıradan
# bir sözcük hex sanılmasın.
_HEX_LONG = re.compile(r"\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{8,}\b")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def log_fingerprint(record: LogRecord) -> str:
    """Logun "aynı hata" kimliği: kaynak + sayıları/hex'leri/UUID'leri silinmiş metin.

    PID, port, adres, süre gibi her tekrarda değişen parçalar maskelenir; aksi
    halde aynı hata her seferinde "yeni" görünür ve bastırma hiç çalışmazdı.
    """
    text = _UUID.sub("<uuid>", record.message)
    text = _HEX_PREFIXED.sub("<hex>", text)
    text = _HEX_LONG.sub("<hex>", text)
    text = _NUMBER.sub("<n>", text)
    return f"{record.source or ''}\x00{text}"


class LogRepeatFilter:
    """Hangi acil logun flush hakkı olduğunu bilen bellek içi tablo.

    State'e YAZILMAZ: hata döngüsünde her log için fsync'li bir state yazımı
    olurdu. Yeniden başlamada tablo boşalır; bedeli, süren bir hatanın bir kez
    daha flush etmesidir — kaybetmek değil tekrarlamak.
    """

    def __init__(self, silence_seconds: float = LOG_SILENCE_SECONDS) -> None:
        self._silence = silence_seconds
        self._last_seen: dict[str, float] = {}

    def observe(self, records: Sequence[LogRecord], now: float) -> bool:
        """Kayıtları işler; en az biri flush hakkı kazandıysa True döner.

        Hak: parmak izi daha önce hiç görülmedi YA DA son görülmesinden bu yana
        sessizlik süresi doldu. Hak kazansın kazanmasın her kayıt "son görülme"yi
        tazeler.
        """
        fresh = False
        for record in records:
            key = log_fingerprint(record)
            previous = self._last_seen.get(key)
            if previous is None or now - previous >= self._silence:
                fresh = True
            self._last_seen[key] = now

        self._prune(now)
        return fresh

    def _prune(self, now: float) -> None:
        # Süresi dolan kayıt silinse de sonuç değişmez (zaten "yeni" sayılırdı).
        expired = [key for key, seen in self._last_seen.items() if now - seen >= self._silence]
        for key in expired:
            del self._last_seen[key]

        overflow = len(self._last_seen) - _MAX_FINGERPRINTS
        if overflow > 0:
            for key in sorted(self._last_seen, key=self._last_seen.__getitem__)[:overflow]:
                del self._last_seen[key]


def _above(value: float | None, threshold: int) -> bool:
    """Ölçüm eşiği aştı mı. Ölçülemeyen alan (None) eşiği aşmış sayılmaz."""
    return value is not None and value > threshold


def disk_step(
    disk_percent: float | None, mark: float | None, threshold: int, step: float
) -> tuple[float | None, bool]:
    """Disk için (yeni çıpa, flush edilsin mi) çifti.

    CPU/RAM'in aksine disk "eşikte kaldığı sürece" değil, DOLMAYA DEVAM ettikçe
    flush eder: ilk aşımda bir kez, sonra yalnızca çıpanın `step` puan üstüne
    çıkınca. Çıpa her flush'ta yukarı kayar ve disk düşse bile yerinde kalır
    (mandal) — doluluk geri çekilip aynı yere dönünce tekrar flush etmez.
    Eşiğin DISK_REARM_MARGIN altına inince çıpa silinir ve sıradaki aşım yine
    "ilk aşım" olur.
    """
    if disk_percent is None:
        return mark, False

    if disk_percent < threshold - DISK_REARM_MARGIN:
        return None, False

    if mark is None:
        if disk_percent > threshold:
            return disk_percent, True
        return None, False

    if disk_percent - mark >= step - _EPSILON:
        return disk_percent, True
    return mark, False


@dataclass(frozen=True)
class Verdict:
    """evaluate()'in kararı. Uygulaması (state yazımı, snapshot) döngünün işidir."""

    # trigger_reason olarak yazılacak tek sebep; flush yoksa None.
    reason: str | None = None
    # cpu veya ram bu turda flush hakkı kazandı → last_flush_at damgalanmalı.
    resource_fired: bool = False
    # Karardan sonraki disk çıpası (değişmediyse eskisiyle aynı).
    disk_mark: float | None = None
    # Eşiği aşan ama kaynak cooldown'ı yüzünden bastırılan sebepler (ram/cpu).
    # Başka bir sayaç aynı turda flush etse de dolar; döngü bunu teşhis satırı
    # olarak yazar.
    cooldown_suppressed: tuple[str, ...] = ()


def evaluate(
    *,
    sample: MetricSample,
    ram_percent: float | None,
    urgent_logs: Sequence[LogRecord],
    config: Config,
    last_flush_at: str | None,
    disk_mark: float | None,
    log_filter: LogRepeatFilter,
    now: float,
) -> Verdict:
    """Üç bağımsız sayacı değerlendirir; flush gerekiyorsa sebebi verir.

    Sayaçlar (CLAUDE.md §7, 2026-10-09 kararı):
      * kaynak (cpu+ram) — eşiğin üstündeyken her cooldown'da tekrar eder; çöküş
        anı bilinemeyeceği için bilerek susturulmaz,
      * disk — çıpa mandalı, bkz. disk_step(),
      * log — parmak izi başına ilk görülmede, sessizlikten sonra yeniden.

    ram_percent ölçümün yanında AYRICA taşınır: MetricSample doğrudan wire
    gövdesi olarak gidiyor ve collector sözleşme dışı alanı 422 ile reddediyor,
    yani yüzde o nesneye eklenemez. Yine de aynı ölçüm anına aittir.

    Birden fazla sayaç aynı turda tutarsa TEK flush yapılır; sütun tek değer
    alır, sebep REASON_ORDER'dan seçilir. Tutan her sayaç yine de kendi
    damgasını ilerletir, yoksa ertesi tur aynı olay için ikinci snapshot çıkardı.

    log_filter bellek içi bir tablodur ve burada güncellenir; bunun dışında
    fonksiyon yan etki üretmez.
    """
    fired: set[str] = set()
    suppressed: list[str] = []

    resource_over = [
        reason
        for reason, over in (
            (REASON_RAM, _above(ram_percent, config.flush_ram_threshold)),
            (REASON_CPU, _above(sample.cpu_percent, config.flush_cpu_threshold)),
        )
        if over
    ]
    if cooldown_active(last_flush_at, config.flush_cooldown_seconds):
        suppressed = resource_over
    else:
        fired.update(resource_over)

    new_mark, disk_fired = disk_step(
        sample.disk_percent,
        disk_mark,
        config.flush_disk_threshold,
        config.disk_flush_step_percent,
    )
    if disk_fired:
        fired.add(REASON_DISK)

    # Pause'da evaluate hiç çağrılmaz; o turlardaki loglar "görülmemiş" kalır ve
    # resume'dan sonra ilk hata flush eder. Doğru yön: gönderilmemiş hata var.
    if log_filter.observe(urgent_logs, now):
        fired.add(REASON_LOG)

    return Verdict(
        reason=next((reason for reason in REASON_ORDER if reason in fired), None),
        resource_fired=bool(fired & {REASON_RAM, REASON_CPU}),
        disk_mark=new_mark,
        cooldown_suppressed=tuple(suppressed),
    )


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
