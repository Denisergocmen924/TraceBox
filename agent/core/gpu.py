"""
GPU okuma — `nvidia-smi` çıktısının tek muhatabı.

NEDEN AYRI MODÜL: GPU iki farklı yere veri verir — model adı envantere
(statik), kullanım ve VRAM metriklere (her ölçümde). İkisi de aynı harici
programa dayanır. Ayrı bir modül olmasaydı `nvidia-smi`nin komut satırı,
çıktı biçimi ve hata halleri iki dosyada birden tekrarlanırdı.

NEDEN SUBPROCESS: pynvml gibi bir kütüphane daha temiz görünür ama kurulum
maliyeti getirir; `nvidia-smi` sürücüyle birlikte zaten gelir. Aynı gerekçe
journald okuması için de kullanıldı (systemd-python yerine `journalctl`
çağrısı) — bağımlılık eklemek yerine sistemde HAZIR olanı çağırmak.

KAPSAM: yalnızca NVIDIA. AMD/Intel GPU'lar için değer null kalır; eklenti
açıksa bile yanlış bir sayı üretilmez.
"""

from __future__ import annotations

import subprocess

# Sürücü kuruluysa PATH'te bulunur. Bulunamaması hata değildir: eklenti açık
# ama makinede NVIDIA GPU yok demektir.
NVIDIA_SMI = "nvidia-smi"

# Ölçüm aralığı saniyelerle ifade ediliyor; yanıt vermeyen bir süreç döngüyü
# bekletmemeli. journald'ın 30 saniyelik payına karşılık burada süre kısa
# tutuldu, çünkü GPU okuması her ölçümde tekrarlanır.
QUERY_TIMEOUT_SECONDS = 2.0

# Çıktı biçimi: başlıksız CSV. `nounits` sayıların yanına birim yazılmasını
# engeller ("34 %" yerine "34"), yani ayrıştırma tek bir float() çağrısıdır.
_CSV_FLAGS = "--format=csv,noheader,nounits"


class GpuReader:
    """nvidia-smi çağrılarını yapan okuyucu.

    Durum tutar çünkü tek bir şeyi hatırlaması gerekir: program sistemde HİÇ
    yoksa bir daha denemeye gerek yok. Ölçüm aralığı saniyelerle ifade edildiği
    için, olmayan bir programı her turda başlatmaya çalışmak sürekli ve boş bir
    süreç yaratma maliyetidir.

    Diğer hatalar (zaman aşımı, sıfırdan farklı çıkış kodu) kalıcı sayılmaz:
    sürücü geçici olarak meşgul olabilir, bir sonraki tur yeniden denenir.
    """

    def __init__(self) -> None:
        self._missing = False

    def read_usage(self) -> tuple[float | None, int | None]:
        """(kullanım yüzdesi, kullanılan VRAM MB) — okunamazsa (None, None).

        Çoklu GPU'da yalnızca İLK kart okunur: şemada tek bir gpu_usage_percent
        sütunu var. Kart başına satır tutmak zaman serisinin şeklini
        değiştirirdi; bugünkü soru "GPU yüklü müydü", "hangi kart" değil.
        """
        line = self._query("utilization.gpu,memory.used")
        if line is None:
            return None, None

        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 2:
            return None, None

        try:
            return round(float(parts[0]), 1), int(float(parts[1]))
        except ValueError:
            # [N/A] gibi sayı olmayan değerler: sürücü o alanı raporlamıyor.
            return None, None

    def read_model(self) -> str | None:
        """GPU model adı (envanter için) — okunamazsa None."""
        line = self._query("name")
        return line or None

    def _query(self, fields: str) -> str | None:
        """Sorguyu çalıştırır ve çıktının İLK satırını döndürür.

        Her hata None'a indirgenir: GPU bir EKLENTİdir, onun yokluğu ölçüm
        turunu düşürmemeli. Ayrım yalnızca "program yok" halinde yapılır,
        çünkü tek kalıcı olan odur.
        """
        if self._missing:
            return None

        try:
            result = subprocess.run(
                [NVIDIA_SMI, f"--query-gpu={fields}", _CSV_FLAGS],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=QUERY_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError:
            self._missing = True
            return None
        except (subprocess.TimeoutExpired, OSError):
            return None

        if result.returncode != 0:
            return None

        first_line = result.stdout.strip().splitlines()
        return first_line[0].strip() if first_line else None
