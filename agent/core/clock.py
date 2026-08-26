"""
Zaman damgası yardımcıları.

Agent iki farklı saat kullanır ve bunlar karıştırılmamalıdır:

  * time.monotonic() — "ne kadar zaman geçti" sorusunu cevaplar. Yalnızca ileri
    gider, sistem saati değişse bile etkilenmez. Döngü sayaçları bunu kullanır
    (loop.py).
  * wall-clock UTC — "hangi an" sorusunu cevaplar. Sunucuya giden her
    measured_at damgası bu modülden çıkar.
"""

from __future__ import annotations

from datetime import datetime, timezone

# Damgalar saniye çözünürlüğünde tutulur: en sık ölçüm aralığı saniyelerle
# ifade ediliyor, mikrosaniye ne payload'da ne grafikte bir şey değiştiriyor.
_TIMESPEC = "seconds"


def utc_now_iso() -> str:
    """Şu anı ISO 8601 UTC olarak döndürür (örn. 2026-08-16T15:02:28+00:00)."""
    return datetime.now(timezone.utc).isoformat(timespec=_TIMESPEC)


def epoch_to_utc_iso(epoch_seconds: float) -> str:
    """Unix zaman damgasını ISO 8601 UTC'ye çevirir.

    psutil.boot_time() gibi epoch döndüren kaynaklar için; yerel saat dilimi
    hesaba katılmaz, değer doğrudan UTC olarak yorumlanır.
    """
    return datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).isoformat(timespec=_TIMESPEC)


def seconds_since_iso(timestamp: str | None) -> float | None:
    """Verilen ISO 8601 damgasından bu yana geçen saniyeyi döndürür.

    İki durumda None döner ve çağıran bunu "ölçülemedi" olarak yorumlar:
      * timestamp None ya da boş — karşılaştırılacak bir an yok,
      * metin ISO 8601 olarak çözülemiyor — state.json elle düzenlenmiş olabilir.

    Sonuç NEGATİF de çıkabilir: damga gelecekte kalmışsa (sistem saati geri
    alınmış) fark eksi olur. Çağıran bu durumu kendi kuralına göre yorumlar;
    burada gizlenmez, çünkü "geçen süre" sorusunun dürüst cevabı budur.
    """
    if not timestamp:
        return None

    try:
        moment = datetime.fromisoformat(timestamp)
    except ValueError:
        return None

    # Saat dilimi taşımayan bir damga UTC kabul edilir: bu modülün ürettiği her
    # damga zaten UTC'dir, dilimsiz bir değer ancak dışarıdan gelmiş olabilir.
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    return (datetime.now(timezone.utc) - moment).total_seconds()
