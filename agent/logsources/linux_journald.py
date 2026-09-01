"""
journald okuyucusu — Linux sistem loglarını LogRecord'lara çevirir.

Okuma `journalctl --output=json` alt süreciyle yapılır; agent'ın journald'a
bağlanan bir kütüphanesi yoktur ([[decisions]] → "journald okuma yolu:
`journalctl` subprocess"). Kazanç kurulumdadır: derleyici isteyen bir C
uzantısı olmadığı için agent, dokunulmamış bir Python'la kurulabilir.

journald'a özgü ne varsa bu dosyada biter. Çekirdek kod ne PRIORITY sayılarını
ne cursor'ın biçimini bilir; elindeki tek şey LogSource arayüzüdür.
"""

from __future__ import annotations

import json
import subprocess

from agent.core.clock import epoch_to_utc_iso, utc_now_iso
from agent.logsources.base import (
    LEVEL_CRITICAL,
    LEVEL_ERROR,
    LEVEL_INFO,
    LEVEL_WARNING,
    Cursor,
    LogRecord,
    LogSource,
    LogSourceError,
)

JOURNALCTL = "journalctl"

# Bir okumada alınacak azami kayıt. shipper.BATCH_ROWS ile aynı: bir okuma en
# fazla bir isteği doldurur. Sınır olmasaydı uzun süre kapalı kalmış bir agent,
# açılışta günlerce birikmiş journal'ı tek hamlede belleğe almaya çalışırdı.
MAX_RECORDS_PER_READ = 500

# Okunan en düşük öncelik (syslog severity). 7 = debug dışarıda bırakılır:
# dört seviyelik şemamızda debug da 6 gibi "info"ya düşer, yani ayırt edilebilir
# bir sinyal eklemeden hacmi büyütür — ve kontrolden çıkması en olası seviyedir.
# Tek satır: debug de istenirse bu 7 olur.
MAX_PRIORITY = 6

# journalctl'in yanıt süresi. Aşılırsa okuma hata sayılır; döngü kilitlenmez.
READ_TIMEOUT_SECONDS = 30.0

MICROSECONDS_PER_SECOND = 1_000_000

# syslog severity (0-7) → sözleşmenin dört seviyesi (base.LEVELS).
_PRIORITY_LEVELS = {
    0: LEVEL_CRITICAL,  # emerg  — sistem kullanılamaz
    1: LEVEL_CRITICAL,  # alert  — hemen müdahale
    2: LEVEL_CRITICAL,  # crit   — kritik durum
    3: LEVEL_ERROR,     # err
    4: LEVEL_WARNING,   # warning
    5: LEVEL_INFO,      # notice
    6: LEVEL_INFO,      # info
    7: LEVEL_INFO,      # debug  (MAX_PRIORITY yükseltilmedikçe gelmez)
}

# Logu üreten birim için sırayla denenen alanlar. _SYSTEMD_UNIT en anlamlısıdır
# ama systemd altında koşmayan süreçlerde boştur.
_SOURCE_FIELDS = ("_SYSTEMD_UNIT", "SYSLOG_IDENTIFIER", "_COMM")

# Agent'ın KENDİ journald kimliği. Unit adı systemd altında, identifier ise
# servis dışında (geliştirme, elle çalıştırma) dolar; ikisi birden bakılıyor.
_SELF_UNIT = "tracebox-agent.service"
_SELF_IDENTIFIER = "tracebox-agent"

# Agent'ın KENDİ loglarından buluta gönderilen en düşük öncelik (4 = warning).
#
# Sorun bir geri besleme döngüsüydü: agent ekrana yazıyor → systemd journald'a
# koyuyor → agent journald'ı okuyup kendi satırlarını buluta geri gönderiyor.
# Her tur en az bir satır ürettiği için günde ~26.000 satır — tek bir cihaz
# için, hiçbiri o cihaz hakkında değil. Kullanıcının 10 günlük penceresini
# agent'ın kendi gevezeliği dolduruyordu.
#
# Tamamen susturmak yanlış olurdu: "collector'a ulaşılamadı" cümlesi
# kullanıcının görmesi gereken bir şey ve onu başka hiçbir yerde göremez.
# Ayrım SEVİYEDE yapılıyor — rutin tur bilgisi ("6 metrik gönderildi") info,
# arıza warning ve üstü. Hacim kayboluyor, teşhis kalıyor.
#
# Not: agent'ın kendi error satırı hâlâ acil gönderim tetikleyebilir (§7).
# Bu bilerek böyle: tetikleme `flush_cooldown_seconds` ile zaten sınırlı ve
# gönderim aralığıyla (10 sn) aynı mertebede, yani ölçülebilir bir maliyet
# eklemiyor. Buna karşılık gerçek bir arızada veriyi biraz daha erken dışarı
# taşıyor.
_SELF_MIN_PRIORITY = 4

# Cursor geçersizleştiğinde kaydın kendisine düşülen not. Atlanan aralık
# sessizce kaybolmaz; dashboard'daki zaman çizelgesinde görünür.
_GAP_MESSAGE = (
    "journald cursor is no longer valid (the journal rotated or was cleared) — "
    "logs up to this point could not be read; reading resumes from now"
)
_GAP_SOURCE = "tracebox-agent"


class JournalError(LogSourceError):
    """journald okunamadı.

    Çağıran turu log'suz sürdürür: metrik toplama ve gönderim, journald
    erişilemez diye durmamalıdır. Çekirdek kod bu sınıfı adıyla tanımaz,
    üst tipi LogSourceError'ı yakalar.
    """


class JournaldSource(LogSource):
    """LogSource'un journald implementasyonu."""

    def read_since(self, cursor: Cursor) -> tuple[list[LogRecord], Cursor]:
        """journalctl'i cursor'dan sonrası için çalıştırır.

        cursor yoksa (ilk çalıştırma) geçmiş okunmaz: o andaki yer imi alınır ve
        boş liste dönülür. Aksi halde kurulum anında aylarca birikmiş journal
        spool'a dolar ve gerçek olayları 10 günlük pencereden dışarı iter.
        """
        if not isinstance(cursor, str) or not cursor:
            return [], self._seek_to_now()

        result = self._run(f"--after-cursor={cursor}", f"--lines={MAX_RECORDS_PER_READ}")

        if result.returncode != 0:
            # Neredeyse her zaman "Failed to seek to cursor": journal döndü ve
            # yer imi artık mevcut değil. Tek çare şimdiden devam etmek — ama
            # atlanan aralık bir kayıt olarak bildirilir.
            fresh = self._seek_to_now()
            return [_gap_record()], fresh

        records: list[LogRecord] = []
        newest = cursor

        for entry in _parse(result.stdout):
            newest = entry.get("__CURSOR", newest)
            record = _to_record(entry)
            if record is not None:
                records.append(record)

        return records, newest

    def _seek_to_now(self) -> Cursor:
        """Şu andaki yer imini döndürür — buradan öncesi okunmaz."""
        result = self._run("--lines=1")
        if result.returncode != 0:
            raise JournalError(f"journalctl hata verdi: {_stderr_summary(result)}")

        entries = _parse(result.stdout)
        if not entries:
            # Journal bomboş (yeni kurulmuş makine). Yer imi yok; bir sonraki
            # tur yeniden dener, arada log doğarsa oradan yakalanır.
            return None

        return entries[-1].get("__CURSOR")

    def _run(self, *args: str) -> subprocess.CompletedProcess:
        """journalctl'i çalıştırır. Süreç başlatılamazsa JournalError."""
        command = [
            JOURNALCTL,
            "--output=json",
            "--no-pager",
            f"--priority={MAX_PRIORITY}",
            *args,
        ]

        try:
            return subprocess.run(
                command,
                capture_output=True,
                text=True,
                # Bozuk baytlar okumayı düşürmesin: journalctl JSON'u UTF-8
                # üretir, yine de tek bir bayt yüzünden tur kaybedilmez.
                errors="replace",
                timeout=READ_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError as error:
            raise JournalError("journalctl not found — this system has no journald") from error
        except subprocess.TimeoutExpired as error:
            raise JournalError(f"journalctl did not respond within {READ_TIMEOUT_SECONDS:.0f}s") from error
        except OSError as error:
            raise JournalError(f"could not run journalctl ({error.__class__.__name__})") from error


def _parse(stdout: str) -> list[dict]:
    """Satır başına bir JSON nesnesi — çözülemeyen satır atlanır.

    Bozuk tek bir satır yüzünden tüm okuma çöpe atılmaz; kalan kayıtlar
    kurtarılır.
    """
    entries = []

    for line in stdout.splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict):
            entries.append(entry)

    return entries


def _to_record(entry: dict) -> LogRecord | None:
    """journald girdisini LogRecord'a indirger.

    İki girdi atlanır ve None döner: metinsiz olanlar ve agent'ın kendi
    rutin (info) satırları. Atlanan girdi de cursor'ı ilerletir — çağıran
    yer imini kaydın kendisinden değil, girdiden okuyor.
    """
    if _is_self_chatter(entry):
        return None

    message = _message_text(entry.get("MESSAGE"))
    if not message.strip():
        return None

    return LogRecord(
        timestamp=_timestamp(entry.get("__REALTIME_TIMESTAMP")),
        level=_level(entry.get("PRIORITY")),
        message=message,
        source=_source(entry),
    )


def _is_self_chatter(entry: dict) -> bool:
    """Girdi, agent'ın kendi rutin (info) satırı mı?

    Ölçüt İKİ parçalı: kaynak agent olacak VE önceliği warning'in altında
    kalacak. Yalnızca kaynağa baksaydık agent'ın arıza mesajları da yok
    olurdu; yalnızca seviyeye baksaydık makinedeki bütün info logları
    gitmiş olurdu — oysa asıl toplamak istediğimiz şey onlar.
    """
    if entry.get("_SYSTEMD_UNIT") != _SELF_UNIT and (
        entry.get("SYSLOG_IDENTIFIER") != _SELF_IDENTIFIER
    ):
        return False

    priority = entry.get("PRIORITY")
    try:
        # journald PRIORITY'yi metin olarak verir ("6"). Okunamayan bir değeri
        # "önemli" saymak güvenli taraf: şüphede kalan kayıt gönderilir.
        return int(priority) > _SELF_MIN_PRIORITY
    except (TypeError, ValueError):
        return False


def _message_text(value: object) -> str:
    """MESSAGE alanını metne çevirir.

    journald metni UTF-8 değilse alanı bayt dizisi (int listesi) olarak verir;
    kayıt yine de okunur, çözülemeyen baytlar yerine U+FFFD konur.
    """
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        try:
            return bytes(value).decode("utf-8", errors="replace")
        except (TypeError, ValueError):
            return ""

    return ""


def _level(value: object) -> str:
    """PRIORITY → dört seviyeden biri. Tanınmayan değer 'info' sayılır.

    Seviyeyi uydurmaktansa en zararsız olanına düşürmek yeğdir: yanlışlıkla
    'critical' demek, acil gönderimi (M7) boşuna tetiklerdi.
    """
    try:
        priority = int(value)
    except (TypeError, ValueError):
        return LEVEL_INFO

    return _PRIORITY_LEVELS.get(priority, LEVEL_INFO)


def _timestamp(value: object) -> str:
    """__REALTIME_TIMESTAMP (mikrosaniye, metin) → ISO 8601 UTC.

    Alan okunamazsa okuma anı damgalanır: damgasız kayıt zaman çizelgesine
    hiç giremezdi.
    """
    try:
        microseconds = int(value)
    except (TypeError, ValueError):
        return utc_now_iso()

    return epoch_to_utc_iso(microseconds / MICROSECONDS_PER_SECOND)


def _source(entry: dict) -> str | None:
    """Logu üreten birim — hiçbiri yoksa None."""
    for field in _SOURCE_FIELDS:
        value = entry.get(field)
        if isinstance(value, str) and value:
            return value

    return None


def _gap_record() -> LogRecord:
    """Atlanan aralığı bildiren sentetik kayıt."""
    return LogRecord(
        timestamp=utc_now_iso(),
        level=LEVEL_WARNING,
        message=_GAP_MESSAGE,
        source=_GAP_SOURCE,
    )


def _stderr_summary(result: subprocess.CompletedProcess) -> str:
    """journalctl'in hata satırı — logda görünecek kadar kısa."""
    detail = (result.stderr or "").strip().splitlines()
    return detail[0][:200] if detail else f"exit code {result.returncode}"
