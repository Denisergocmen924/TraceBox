"""
Log kaynağı sözleşmesi — LogRecord (log NE'dir) + LogSource (okuyucu NE YAPAR).

Bu modül hiçbir log okumaz. Ne journald'ı ne başka bir kaynağı import eder;
yalnızca iki şekil tarif eder. Gerçek okuma implementasyonlarda yapılır
(linux_journald.py), çekirdek kod ise yalnızca buradaki arayüzü çağırır.

Sözleşme CLAUDE.md §4.1'de kilitlidir; alan adları ve seviye kümesi buradan
değiştirilmez.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

# Sistemin tanıdığı tek seviye kümesi. Sıra ciddiyete göredir: soldan sağa artar.
# logs.level sütunu da tam olarak bu dört değeri kabul eder (db/schema.sql);
# listede olmayan bir seviye veritabanına ulaşamadan reddedilir.
LEVEL_INFO = "info"
LEVEL_WARNING = "warning"
LEVEL_ERROR = "error"
LEVEL_CRITICAL = "critical"

LEVELS = (LEVEL_INFO, LEVEL_WARNING, LEVEL_ERROR, LEVEL_CRITICAL)

# Acil gönderimi tetikleyen seviyeler (M7 — flush.py). Bir log bu kümedeyse
# 30 saniyelik gönderim turu beklenmez.
URGENT_LEVELS = (LEVEL_ERROR, LEVEL_CRITICAL)

# Cursor, log kaynağının "nereye kadar okudum" yer imidir. İçeriği kaynağa
# özgüdür ve çekirdek kod tarafından ASLA yorumlanmaz; yalnızca saklanır ve bir
# sonraki okumada geri verilir. state.json'a yazıldığı için JSON'a çevrilebilir
# olmak zorundadır (journald'ınki bir string). Henüz hiç okuma yapılmamışsa None.
Cursor = object | None


@dataclass(frozen=True)
class LogRecord:
    """Tek bir log satırı — kaynağı ne olursa olsun bu şekle indirgenmiştir.

    frozen=True: kayıt okunduktan sonra değiştirilmez; normalize etme işi
    okuyucunun içinde biter, dışarıda kimse üzerine yazmaz.
    """

    # Logun kaynakta doğduğu an, ISO 8601 (UTC). Ölçüm anıdır; sunucuya
    # gönderilirken wire gövdesinde measured_at alanına yazılır.
    timestamp: str

    # LEVELS içinden bir değer. Kaynağın kendi seviye şeması (journald'ın 8
    # PRIORITY değeri gibi) okuyucu tarafından bu dörde indirgenir.
    level: str

    # Log metni. Kırpılmaz — uzun mesaj bilerek kabul edilir (CLAUDE.md §4.1).
    message: str

    # Logu üreten servis/birim (journald'da _SYSTEMD_UNIT). Kaynak bunu
    # veremiyorsa None kalır; zorunlu bir alan değildir.
    source: str | None = None


class LogSourceError(Exception):
    """Log kaynağı okunamadı.

    Sözleşmenin parçasıdır: çekirdek kod, hangi implementasyonun hangi sebeple
    başarısız olduğunu bilmeden bu tek tipi yakalar. Alt sınıflar (journald'ın
    JournalError'ı gibi) ayrıntıyı mesajda taşır.

    RuntimeError'dan DEĞİL Exception'dan türer: __main__ RuntimeError'ı "agent
    zaten çalışıyor" diye yorumluyor; log okuma hatası oraya karışmamalı.
    """


class LogSource(ABC):
    """Bir işletim sisteminin log akışını LogRecord'lara çeviren okuyucu.

    Her OS için bir alt sınıf yazılır. Çekirdek kod hangi alt sınıfla
    çalıştığını bilmez; elindeki tek şey bu arayüzdür.
    """

    @abstractmethod
    def read_since(self, cursor: Cursor) -> tuple[list[LogRecord], Cursor]:
        """Verilen cursor'dan bu yana biriken logları ve YENİ cursor'ı döndürür.

        cursor=None ise okuyucu kendi başlangıç noktasını seçer (ilk kurulumda
        tüm geçmişi değil, o andan sonrasını okumak beklenir).

        Dönen cursor, okunan son kaydın yer imidir ve çağıran tarafından
        state.json'a yazılır. Bir sonraki çağrıda geri verilince aynı loglar
        tekrar okunmaz; agent yeniden başlasa da kaldığı yerden devam eder.

        Yeni log yoksa boş liste ve DEĞİŞMEMİŞ cursor döner — çağıran bu iki
        durumu ayırt etmek zorunda kalmaz.
        """
