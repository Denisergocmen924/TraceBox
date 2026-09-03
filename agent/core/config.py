"""
Yapılandırma okuyucu — config.toml'u okur, doğrular ve Config nesnesine çevirir.

Bu modül yalnızca OKUR. Agent'ın yazdığı tek dosya state.json'dır (state.py).
"""

from __future__ import annotations

import os
import stat
import tomllib
from dataclasses import dataclass
from pathlib import Path

# Üretimdeki config yolu. TRACEBOX_CONFIG ortam değişkeni tanımlıysa onun değeri
# kullanılır, tanımlı değilse buraya düşülür — yani geliştirme override'ı opt-in,
# üretim yolu varsayılandır.
DEFAULT_CONFIG_PATH = Path("/etc/tracebox/config.toml")
CONFIG_PATH_ENV_VAR = "TRACEBOX_CONFIG"

# send_interval_seconds için alt sınır. Config'e daha küçük bir
# değer yazılırsa sessizce yok sayılmaz: floor uygulanır ve uyarı basılır.
MIN_SEND_INTERVAL_SECONDS = 10

# config.toml düz `device_key`i barındırır. Bu bitlerden herhangi biri açıksa
# dosyayı sahibinden BAŞKASI da okuyabiliyor demektir; makinedeki başka bir
# yerel kullanıcı anahtarı alıp cihazı taklit edebilir.
INSECURE_PERMISSION_BITS = (
    stat.S_IRGRP | stat.S_IWGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IWOTH | stat.S_IXOTH
)

# Seçilebilir eklentilerin adları. Tek tanım yeri BURASI: eklentiyi toplayan
# modüller (metrics, inventory, flush) bu sabitleri import eder, böylece
# config.toml'daki metinle kodun beklediği metin ayrışamaz.
ADDON_TEMPERATURE = "temperature"
ADDON_SWAP = "swap"
ADDON_LOAD_AVG = "load_avg"
ADDON_GPU = "gpu"
ADDON_EXTERNAL_IP = "external_ip"
ADDON_CRASH_PROCESSES = "crash_processes"

KNOWN_ADDONS = (
    ADDON_TEMPERATURE,
    ADDON_SWAP,
    ADDON_LOAD_AVG,
    ADDON_GPU,
    ADDON_EXTERNAL_IP,
    ADDON_CRASH_PROCESSES,
)

# Config'de bulunması ZORUNLU alanlar. Eksikse agent açılışta durur; varsayılan
# uydurmak, yanlış adrese veri göndermeye çalışan bir agent üretirdi.
REQUIRED_KEYS = ("collector_url", "device_key")


class ConfigError(Exception):
    """Config okunamadı, ayrıştırılamadı ya da zorunlu bir alan eksik."""


@dataclass(frozen=True)
class Config:
    """config.toml'un ayrıştırılmış hali.

    frozen=True: nesne oluşturulduktan sonra değiştirilemez. Döngü her tick'te
    dosyayı yeniden okuyup YENİ bir Config üretir; eldeki nesneyi kimse yerinde
    düzenlemez.
    """

    # --- Bağlantı ---
    collector_url: str
    device_key: str

    # --- Zamanlama (saniye) ---
    collect_interval_seconds: int = 5
    send_interval_seconds: int = 10
    command_poll_seconds: int = 10

    # --- Acil gönderim eşikleri (yüzde) ---
    flush_cpu_threshold: int = 90
    flush_ram_threshold: int = 90
    flush_disk_threshold: int = 95
    flush_cooldown_seconds: int = 10

    # --- Spool sınırları ---
    spool_max_age_days: int = 10
    spool_max_size_mb: int = 200

    # --- Eklentiler ---
    # Liste yerine tuple: frozen dataclass'ın içeriği de değiştirilemez olsun.
    enabled_addons: tuple[str, ...] = ()


def config_path() -> Path:
    """Kullanılacak config yolunu döndürür.

    Ortam değişkeni tanımlı ve boş değilse onu, aksi halde üretim yolunu verir.
    """
    override = os.environ.get(CONFIG_PATH_ENV_VAR, "").strip()
    return Path(override) if override else DEFAULT_CONFIG_PATH


def check_permissions(path: Path, mode: int, *, warn) -> bool:
    """Config dosyasının izin bitlerini denetler; gevşekse uyarı basar.

    Agent DURDURULMAZ. Çalışan bir izleme aracını izin biti yüzünden öldürmek,
    makineyi tamamen gözsüz bırakır — yani çözdüğünden büyük bir sorun yaratır.
    Uyarı journald'a düşer ve `systemctl status tracebox-agent` ile görülür.

    Dönen değer: izinler güvenliyse True.
    """
    if not stat.S_IMODE(mode) & INSECURE_PERMISSION_BITS:
        return True

    warn(
        f"permissions on {path} are too open ({stat.filemode(mode)}); other users "
        f"on this machine can read the device key. To fix: chmod 600 {path}"
    )
    return False


def _positive_int(raw: dict, key: str, default: int) -> int:
    """raw[key]'i pozitif tam sayı olarak okur; yoksa default'a düşer.

    bool'u ayrıca eler: Python'da bool, int'in alt sınıfıdır, yani
    `isinstance(True, int)` doğrudur ve `collect_interval_seconds = true`
    yazılmış bir config sessizce 1 saniye olarak yorumlanırdı.
    """
    if key not in raw:
        return default

    value = raw[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(f"'{key}' must be an integer, got: {value!r}")
    if value <= 0:
        raise ConfigError(f"'{key}' must be greater than zero, got: {value}")
    return value


def _parse(raw: dict, *, warn) -> Config:
    """Ayrıştırılmış TOML sözlüğünü doğrulanmış bir Config'e çevirir.

    warn: uyarı mesajlarını basan çağrılabilir (döngü stdout'a, testler listeye
    yazabilsin diye dışarıdan verilir).
    """
    for key in REQUIRED_KEYS:
        value = raw.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ConfigError(f"required field is missing or empty: '{key}'")

    send_interval = _positive_int(raw, "send_interval_seconds", 10)
    if send_interval < MIN_SEND_INTERVAL_SECONDS:
        warn(
            f"send_interval_seconds={send_interval} is below the minimum; "
            f"using {MIN_SEND_INTERVAL_SECONDS} instead."
        )
        send_interval = MIN_SEND_INTERVAL_SECONDS

    addons = raw.get("enabled_addons", [])
    if not isinstance(addons, list) or not all(isinstance(a, str) for a in addons):
        raise ConfigError("'enabled_addons' must be a list of strings")

    # Tanınmayan ad HATA DEĞİL, uyarıdır: yazım hatası yüzünden agent'ı
    # başlatmamak, bir eklentinin toplanmamasından daha ağır bir sonuç olurdu.
    # Ama sessiz de kalınmaz — "temprature" yazan kullanıcı, sıcaklık sütunu
    # neden hep null diye günlerce bakabilirdi.
    unknown = [name for name in addons if name not in KNOWN_ADDONS]
    if unknown:
        warn(
            f"unknown name in enabled_addons: {', '.join(unknown)} — ignored. "
            f"Valid values: {', '.join(KNOWN_ADDONS)}"
        )

    return Config(
        collector_url=raw["collector_url"].strip().rstrip("/"),
        device_key=raw["device_key"].strip(),
        collect_interval_seconds=_positive_int(raw, "collect_interval_seconds", 5),
        send_interval_seconds=send_interval,
        command_poll_seconds=_positive_int(raw, "command_poll_seconds", 10),
        flush_cpu_threshold=_positive_int(raw, "flush_cpu_threshold", 90),
        flush_ram_threshold=_positive_int(raw, "flush_ram_threshold", 90),
        flush_disk_threshold=_positive_int(raw, "flush_disk_threshold", 95),
        flush_cooldown_seconds=_positive_int(raw, "flush_cooldown_seconds", 10),
        spool_max_age_days=_positive_int(raw, "spool_max_age_days", 10),
        spool_max_size_mb=_positive_int(raw, "spool_max_size_mb", 200),
        enabled_addons=tuple(addons),
    )


class ConfigLoader:
    """Config dosyasını okur ve dosya değişene kadar önbellekte tutar.

    Döngü her tick'te (saniyede bir) load() çağırır; böylece kullanıcının
    config.toml'da yaptığı değişiklik servisi yeniden başlatmadan geçerli olur.
    Her çağrıda dosyayı yeniden AYRIŞTIRMAK gereksiz olduğu için mtime + boyut
    karşılaştırılır, yalnızca değiştiyse yeniden okunur.
    """

    def __init__(self, path: Path | None = None, *, warn=print) -> None:
        self._path = path if path is not None else config_path()
        self._warn = warn
        self._cached: Config | None = None
        self._signature: tuple[float, int, int] | None = None

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> Config:
        """Güncel Config'i döndürür.

        İLK çağrı başarısız olursa ConfigError yükseltir — agent yanlış ya da
        eksik yapılandırmayla açılmaz. Sonraki çağrılarda hata olursa (kullanıcı
        dosyayı düzenlerken yarım kaydetmiş olabilir) son geçerli Config
        korunur ve uyarı basılır; çalışan agent bir yazım hatası yüzünden ölmez.
        """
        try:
            info = self._path.stat()
            # İzin bitleri de imzanın parçası: `chmod` mtime'ı da boyutu da
            # değiştirmez, yani izinler yalnızca burada takip edilirse sonradan
            # gevşetilen bir dosya fark edilmeden kalırdı.
            signature = (info.st_mtime, info.st_size, info.st_mode)

            # Dosya son okumadan beri değişmediyse ayrıştırmayı atla.
            if self._cached is not None and signature == self._signature:
                return self._cached

            # İzin denetimi yalnızca dosya (yeniden) okunurken çalışır; her
            # tick'te uyarı basılsaydı log'u doldururdu.
            check_permissions(self._path, info.st_mode, warn=self._warn)

            with self._path.open("rb") as handle:
                raw = tomllib.load(handle)

            config = _parse(raw, warn=self._warn)

        except (OSError, tomllib.TOMLDecodeError, ConfigError) as exc:
            if self._cached is None:
                raise ConfigError(f"could not read {self._path}: {exc}") from exc
            self._warn(f"could not re-read config ({exc}); keeping the previous settings.")
            return self._cached

        self._cached = config
        self._signature = signature
        return config
