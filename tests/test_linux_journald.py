"""
linux_journald testleri — journalctl çıktısının LogRecord'a çevrilmesi.

Gerçek journalctl çağrılmaz: `subprocess.run` sahtesiyle değiştirilir. Böylece
testler hangi makinede koştuğuna bakmaz (CI'ın journal'ı bu makinenin journal'ı
değildir) ve gerçekte üretilmesi zor durumlar — geçersiz cursor, ikili mesaj,
bozuk satır — istenildiği gibi kurulabilir.

Sahteleme sınırı üretim kodunun DIŞINDADIR: linux_journald.py'ye test kancası
eklenmedi, yalnızca çağırdığı subprocess değiştirildi (shipper testlerindeki
yaklaşımın aynısı).
"""

from __future__ import annotations

import json
import subprocess

import pytest

from agent.logsources.base import LogRecord
from agent.logsources.linux_journald import (
    MAX_PRIORITY,
    MAX_RECORDS_PER_READ,
    JournalError,
    JournaldSource,
)


class FakeJournalctl:
    """Sıraya konan yanıtları veren sahte journalctl."""

    def __init__(self) -> None:
        self.commands: list[list[str]] = []
        self._queue: list[object] = []

    def queue(self, stdout: str = "", returncode: int = 0, stderr: str = "") -> None:
        self._queue.append(
            subprocess.CompletedProcess(
                args=[], returncode=returncode, stdout=stdout, stderr=stderr
            )
        )

    def raises(self, error: Exception) -> None:
        """Bir sonraki çağrıda süreç hiç başlamaz."""
        self._queue.append(error)

    def run(self, command, **kwargs):
        self.commands.append(list(command))
        if not self._queue:
            return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")

        response = self._queue.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    @property
    def last_command(self) -> list[str]:
        return self.commands[-1]


@pytest.fixture
def journalctl(monkeypatch) -> FakeJournalctl:
    fake = FakeJournalctl()
    monkeypatch.setattr("agent.logsources.linux_journald.subprocess.run", fake.run)
    return fake


def entry(cursor: str = "s=c1", priority: str = "6", message: object = "mesaj", **extra) -> dict:
    """Bir journald girdisi — testin ilgilenmediği alanlar makul varsayılanlarla."""
    row = {
        "__CURSOR": cursor,
        "__REALTIME_TIMESTAMP": "1755349827000000",
        "PRIORITY": priority,
        "MESSAGE": message,
    }
    row.update(extra)
    return {key: value for key, value in row.items() if value is not None}


def stdout_of(*entries: dict) -> str:
    """journalctl --output=json çıktısı: satır başına bir JSON nesnesi."""
    return "\n".join(json.dumps(item) for item in entries) + "\n"


# ---------------------------------------------------------------- ilk okuma


def test_first_read_skips_history(journalctl):
    """cursor yoksa geçmiş dökülmez; yalnızca o anki yer imi alınır.

    Aksi halde kurulum anında aylarca birikmiş journal spool'a dolar ve gerçek
    olayları 10 günlük pencereden dışarı iterdi.
    """
    journalctl.queue(stdout=stdout_of(entry(cursor="s=simdi")))

    records, cursor = JournaldSource().read_since(None)

    assert records == []
    assert cursor == "s=simdi"
    assert "--lines=1" in journalctl.last_command


def test_empty_journal_leaves_the_cursor_unset(journalctl):
    """Hiç log yoksa yer imi de yok — bir sonraki tur yeniden dener."""
    journalctl.queue(stdout="")

    records, cursor = JournaldSource().read_since(None)

    assert records == []
    assert cursor is None


# ---------------------------------------------------------------- okuma penceresi


def test_reads_only_after_the_given_cursor(journalctl):
    """Okuma cursor'dan SONRASINI ister; aksi halde her tur aynı loglar gelirdi."""
    journalctl.queue(stdout=stdout_of(entry()))

    JournaldSource().read_since("s=onceki")

    assert "--after-cursor=s=onceki" in journalctl.last_command


def test_read_is_capped(journalctl):
    """Tek okumada alınacak kayıt sayısı sınırlıdır.

    Sınır olmasaydı uzun süre kapalı kalmış bir agent, günlerce birikmiş
    journal'ı tek hamlede belleğe almaya çalışırdı.
    """
    journalctl.queue(stdout=stdout_of(entry()))

    JournaldSource().read_since("s=onceki")

    assert f"--lines={MAX_RECORDS_PER_READ}" in journalctl.last_command


def test_debug_is_filtered_at_the_source(journalctl):
    """debug (PRIORITY=7) journalctl düzeyinde elenir — hacim ağa hiç çıkmaz."""
    journalctl.queue(stdout=stdout_of(entry()))

    JournaldSource().read_since("s=onceki")

    assert f"--priority={MAX_PRIORITY}" in journalctl.last_command
    assert MAX_PRIORITY == 6


# ---------------------------------------------------------------- cursor ilerlemesi


def test_cursor_advances_to_the_last_entry(journalctl):
    """Yeni yer imi okunan SON kaydınkidir — sıradaki okuma buradan devam eder."""
    journalctl.queue(stdout=stdout_of(entry(cursor="s=a"), entry(cursor="s=b"), entry(cursor="s=c")))

    records, cursor = JournaldSource().read_since("s=onceki")

    assert len(records) == 3
    assert cursor == "s=c"


def test_cursor_stays_put_when_nothing_is_new(journalctl):
    """Yeni log yoksa yer imi geri gitmez; boş liste ve AYNI cursor döner."""
    journalctl.queue(stdout="")

    records, cursor = JournaldSource().read_since("s=onceki")

    assert records == []
    assert cursor == "s=onceki"


# ---------------------------------------------------------------- normalize etme


@pytest.mark.parametrize(
    "priority, expected",
    [
        ("0", "critical"),  # emerg
        ("1", "critical"),  # alert
        ("2", "critical"),  # crit
        ("3", "error"),
        ("4", "warning"),
        ("5", "info"),  # notice
        ("6", "info"),
        ("7", "info"),  # debug
    ],
)
def test_priority_maps_to_the_four_levels(journalctl, priority, expected):
    """journald'ın 8 seviyesi sözleşmenin 4 seviyesine iner (CLAUDE.md §4.1)."""
    journalctl.queue(stdout=stdout_of(entry(priority=priority)))

    records, _ = JournaldSource().read_since("s=onceki")

    assert records[0].level == expected


@pytest.mark.parametrize("priority", ["", "abc", "99", None])
def test_unrecognised_priority_becomes_info(journalctl, priority):
    """Tanınmayan seviye 'info' sayılır — uydurulmuş bir 'critical' M7'de
    acil gönderimi boşuna tetiklerdi."""
    journalctl.queue(stdout=stdout_of(entry(priority=priority)))

    records, _ = JournaldSource().read_since("s=onceki")

    assert records[0].level == "info"


def test_timestamp_becomes_iso_utc(journalctl):
    """__REALTIME_TIMESTAMP mikrosaniyedir; measured_at ISO 8601 UTC olur."""
    journalctl.queue(stdout=stdout_of(entry(__REALTIME_TIMESTAMP="1755349827000000")))

    records, _ = JournaldSource().read_since("s=onceki")

    assert records[0].timestamp == "2025-08-16T13:10:27+00:00"


def test_message_and_source_are_carried_over(journalctl):
    """Metin ve üreten birim olduğu gibi taşınır; mesaj kırpılmaz."""
    uzun = "x" * 20000
    journalctl.queue(stdout=stdout_of(entry(message=uzun, _SYSTEMD_UNIT="nginx.service")))

    records, _ = JournaldSource().read_since("s=onceki")

    assert records[0] == LogRecord(
        timestamp="2025-08-16T13:10:27+00:00",
        level="info",
        message=uzun,
        source="nginx.service",
    )


@pytest.mark.parametrize(
    "fields, expected",
    [
        ({"_SYSTEMD_UNIT": "cron.service", "SYSLOG_IDENTIFIER": "cron"}, "cron.service"),
        ({"SYSLOG_IDENTIFIER": "sudo", "_COMM": "sudo.bin"}, "sudo"),
        ({"_COMM": "bash"}, "bash"),
        ({}, None),
    ],
)
def test_source_falls_back_field_by_field(journalctl, fields, expected):
    """_SYSTEMD_UNIT en anlamlısıdır ama systemd altında koşmayan süreçlerde boştur."""
    journalctl.queue(stdout=stdout_of(entry(**fields)))

    records, _ = JournaldSource().read_since("s=onceki")

    assert records[0].source == expected


def test_binary_message_is_decoded(journalctl):
    """UTF-8 olmayan metni journald bayt dizisi olarak verir; kayıt yine okunur."""
    journalctl.queue(stdout=stdout_of(entry(message=[104, 101, 121, 255])))

    records, _ = JournaldSource().read_since("s=onceki")

    assert records[0].message.startswith("hey")


def test_entry_without_a_message_is_skipped(journalctl):
    """Metinsiz girdi atlanır ama cursor yine de ilerler — takılıp kalınmaz."""
    journalctl.queue(
        stdout=stdout_of(entry(cursor="s=a", message=None), entry(cursor="s=b", message="  "))
    )

    records, cursor = JournaldSource().read_since("s=onceki")

    assert records == []
    assert cursor == "s=b"


# ---------------------------------------------------------------- hata yolları


def test_a_broken_line_does_not_lose_the_batch(journalctl):
    """Çözülemeyen tek satır atlanır; aynı okumadaki diğer kayıtlar kurtarılır."""
    journalctl.queue(
        stdout=stdout_of(entry(cursor="s=a")) + "{bozuk json\n" + stdout_of(entry(cursor="s=b"))
    )

    records, cursor = JournaldSource().read_since("s=onceki")

    assert len(records) == 2
    assert cursor == "s=b"


def test_invalid_cursor_recovers_and_reports_the_gap(journalctl):
    """Journal dönmüşse yer imi kaybolur.

    Tek çare şimdiden devam etmektir; atlanan aralık sessizce kaybolmasın diye
    bir uyarı kaydı üretilir — boşluk zaman çizelgesinde görünür.
    """
    journalctl.queue(returncode=1, stderr="Failed to seek to cursor: Invalid argument")
    journalctl.queue(stdout=stdout_of(entry(cursor="s=yeni")))

    records, cursor = JournaldSource().read_since("s=kayip")

    assert cursor == "s=yeni"
    assert len(records) == 1
    assert records[0].level == "warning"
    assert "cursor" in records[0].message


def test_a_persistent_failure_is_raised(journalctl):
    """Yeniden konumlanma da başarısızsa sorun cursor değildir: sessizce her tur
    baştan başlamak yerine hata yükseltilir."""
    journalctl.queue(returncode=1, stderr="Failed to seek to cursor: Invalid argument")
    journalctl.queue(returncode=1, stderr="No journal files were found")

    with pytest.raises(JournalError):
        JournaldSource().read_since("s=kayip")


def test_missing_journalctl_raises(journalctl):
    """journald olmayan bir sistemde okuma sessizce boş dönmez."""
    journalctl.raises(FileNotFoundError("journalctl"))

    with pytest.raises(JournalError):
        JournaldSource().read_since(None)


def test_a_hanging_journalctl_raises(journalctl):
    """Yanıt vermeyen journalctl döngüyü kilitlemez; zaman aşımı hataya döner."""
    journalctl.raises(subprocess.TimeoutExpired(cmd="journalctl", timeout=30))

    with pytest.raises(JournalError):
        JournaldSource().read_since(None)
