"""
Giriş noktası — `python -m agent` bu dosyayı çalıştırır.

systemd unit'i de aynı komutu çağırır. Buradaki tek iş
bağlamı kurup döngüye devretmek ve açılış hatalarını anlaşılır bir mesaja
çevirmek; iş mantığı agent.core içindedir.

İki mod var:
  python -m agent            servisi çalıştırır (systemd bunu kullanır)
  python -m agent --verify   bağlantıyı sınar ve çıkar (install.sh + teşhis)
"""

from __future__ import annotations

import sys

from agent.core import loop
from agent.core.config import ConfigError, ConfigLoader
from agent.core.state import SingleWriterLock, StateStore
from agent.core.verify import verify
from agent.logsources.linux_journald import JournaldSource

# Çıkış kodları. systemd Restart=on-failure ile çalıştığı için sıfırdan farklı
# her kod yeniden başlatma tetikler.
EXIT_OK = 0
EXIT_CONFIG_ERROR = 1
EXIT_ALREADY_RUNNING = 2
EXIT_VERIFY_FAILED = 3

VERIFY_FLAG = "--verify"

USAGE = """Kullanım:
  python -m agent             agent servisini çalıştırır
  python -m agent --verify    collector bağlantısını sınar, sonra çıkar
"""


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    if args and args != [VERIFY_FLAG]:
        print(USAGE, file=sys.stderr, flush=True)
        return EXIT_CONFIG_ERROR

    loader = ConfigLoader()

    try:
        # Her iki modda da config önce okunur: yapılandırma hatalı ya da eksikse
        # agent hiç açılmasın, yanlış ayarla çalışmasın.
        config = loader.load()
    except ConfigError as exc:
        print(f"config hatası: {exc}", file=sys.stderr, flush=True)
        return EXIT_CONFIG_ERROR

    if args == [VERIFY_FLAG]:
        return _run_verify(config)

    store = StateStore()

    # Bu cihaza `delete` komutu uygulanmışsa agent bir daha açılmaz. İşaret
    # dosyası dururken açılsaydı, kaydı silinmiş cihaz her poll'da 401 alan bir
    # süreç olarak sonsuza kadar dönerdi. Çıkış kodu 0: systemd
    # Restart=on-failure ile çalışıyor, yani yeniden başlatmaz.
    if store.is_deleted():
        print(
            f"Bu cihaz silindi ({store.deleted_marker_path}); agent başlatılmadı.\n"
            "Kurulumu tamamen kaldırmak için: sudo /opt/tracebox/uninstall.sh --yes",
            flush=True,
        )
        return EXIT_OK

    # Tek platform seçimi buradadır: Windows desteği geldiğinde değişecek satır
    # bu, döngü değil.
    log_source = JournaldSource()

    try:
        # Kilit tüm çalışma boyunca tutulur; süreç bittiğinde bırakılır.
        with SingleWriterLock(store.directory):
            loop.run(loader, store, log_source)
    except RuntimeError as exc:
        print(f"başlatılamadı: {exc}", file=sys.stderr, flush=True)
        return EXIT_ALREADY_RUNNING
    except OSError as exc:
        print(f"dosya erişim hatası: {exc}", file=sys.stderr, flush=True)
        return EXIT_CONFIG_ERROR

    return EXIT_OK


def _run_verify(config) -> int:
    """Bağlantı testini çalıştırır ve sonucu kullanıcıya basar.

    Başarısızlık stderr'e yazılır: install.sh çıktıyı ayırt edebilsin ve
    kullanıcı hatayı boru hattında kaybetmesin.
    """
    result = verify(config)

    if result.ok:
        print(f"✓ Kuruldu ve bağlandı — {result.detail}", flush=True)
        return EXIT_OK

    print(f"✗ Bağlanamadı — {result.detail}", file=sys.stderr, flush=True)
    return EXIT_VERIFY_FAILED


if __name__ == "__main__":
    sys.exit(main())
