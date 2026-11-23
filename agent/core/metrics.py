"""
Ölçüm toplama — psutil ile CPU, RAM ve disk.

Çekirdek metrikler HER ZAMAN toplanır: cpu_percent, ram_used_mb, disk_percent.
Eklenti alanları (sıcaklık, swap, load average, GPU) yalnızca config'in
enabled_addons listesinde adı geçiyorsa okunur; kapalıyken alan null kalır.

Eklentilerin varsayılan olarak KAPALI olmasının sebebi ölçüm maliyeti değil,
anlam maliyetidir: her makinede olmayan bir sütun (sıcaklık sensörü,
NVIDIA GPU, Linux'a özgü load average) açıkça istenmeden doldurulmaz.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import psutil

from agent.core.clock import utc_now_iso
from agent.core.config import (
    ADDON_GPU,
    ADDON_LOAD_AVG,
    ADDON_SWAP,
    ADDON_TEMPERATURE,
    Config,
)
from agent.core.gpu import GpuReader

# Bayt -> MB çevrimi ikili tabanda (MiB). Şema sütunları "mb" adını taşır ama
# RAM ve disk değerleri işletim sisteminin raporladığı ikili birimdir; tek bir
# çevrim sabiti kullanmak RAM ve swap sayılarının aynı ölçekte kalmasını sağlar.
BYTES_PER_MB = 1024 * 1024

# Sıcaklık okunurken denenecek sensör adları, sırayla. İlk bulunan kullanılır.
#
# Sıra keyfi değil, DARALAN güvenilirlikte: coretemp (Intel) ve k10temp (AMD)
# doğrudan CPU çekirdeğini ölçer; cpu_thermal ARM kartlarının (Raspberry Pi)
# karşılığıdır; acpitz ise anakart sensörüdür ve CPU'ya yalnızca yakındır.
#
# Şemada sensör ADInı tutan bir sütun YOK — yani temperature_c'nin neyi
# ölçtüğü satırdan okunamaz. Bu yüzden "bulduğun ilk sensörü al" yaklaşımı
# kullanılmaz: aynı grafikteki iki nokta iki farklı şeyi anlatabilirdi.
CPU_SENSOR_NAMES = ("coretemp", "k10temp", "cpu_thermal", "acpitz")

# Doluluk oranının okunduğu bağlama noktası. Envanterdeki disk_total_mb de
# buradan gelir, böylece yüzde ile toplam aynı diski anlatır.
DISK_MOUNT_POINT = "/"


@dataclass(frozen=True)
class MetricSample:
    """Tek bir ölçüm anı — metrics tablosundaki bir satıra karşılık gelir.

    uuid agent tarafından üretilir: aynı örnek ağ hatası yüzünden iki kez
    gönderilse bile sunucu ON CONFLICT (id) DO NOTHING ile tekrarı eler.
    """

    uuid: str
    measured_at: str
    cpu_percent: float | None
    ram_used_mb: int
    disk_percent: float

    # --- eklentiler: kapalıyken None, yani sütun null kalır ---
    # Varsayılan değerleri var çünkü çekirdek alanların aksine bunların
    # OLMAMASI normaldir; her çağrının hepsini vermesi gerekmez.
    temperature_c: float | None = None
    swap_used_mb: int | None = None
    load_avg_1: float | None = None
    load_avg_5: float | None = None
    load_avg_15: float | None = None
    gpu_usage_percent: float | None = None
    gpu_vram_used_mb: int | None = None


@dataclass(frozen=True)
class MetricReading:
    """Tek bir toplama turunun sonucu.

    İki parça taşır çünkü ikisinin gideceği yer farklıdır:
      * sample — spool'a yazılıp collector'a gönderilir,
      * ram_percent — yalnızca flush eşiği karşılaştırmasında kullanılır,
        hiçbir yere kaydedilmez.

    Yüzde MetricSample'ın İÇİNE konamaz: o nesne asdict() ile doğrudan wire
    gövdesine dönüşüyor ve collector sözleşme dışı alanı 422 ile reddediyor.
    Ayrı taşınması, eşiğin bakacağı değerin kaydedilen satırla aynı ölçüm anına
    ait olmasını sağlar.
    """

    sample: MetricSample
    ram_percent: float | None


class MetricsCollector:
    """Ardışık ölçümler arasında fark gerektiren alanın durumunu tutar.

    CPU yüzdesi MUTLAK bir değer değildir; "önceki ölçümden bu yana"
    hesaplanır. Bu yüzden toplayıcı bir nesnedir: psutil'in taban değeri alındı
    mı bilgisini bellekte taşır. Bu bilgi bilerek state.json'a yazılmaz.
    """

    def __init__(self, disk_mount_point: str = DISK_MOUNT_POINT) -> None:
        self._disk_mount_point = disk_mount_point
        # psutil.cpu_percent'in taban değeri alındı mı.
        self._cpu_primed = False
        # GPU eklentisi kapalıyken hiç kullanılmaz; nesne durum tuttuğu için
        # (nvidia-smi var mı) toplayıcıyla aynı ömrü paylaşır.
        self._gpu = GpuReader()

    def collect(self, config: Config) -> MetricReading:
        """Tek bir ölçüm alır.

        config her çağrıda YENİDEN verilir: kullanıcı config.toml'da bir
        eklentiyi açtığında değişiklik servis yeniden başlatılmadan geçerli
        olsun diye (döngü her tick'te dosyayı yeniden okuyor).

        Fark gerektiren alan (cpu_percent) hesaplanamadığında None döner;
        çağıran bunu doğrudan null olarak kaydeder. 0.0 yazmak "yük yoktu"
        anlamına gelirdi ve ölçülemeyen bir anı sıfırla karıştırırdı.

        Dönen MetricReading, kaydedilecek örneğin yanında RAM yüzdesini de
        taşır; ikisi de AYNI psutil okumasından çıkar.
        """
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage(self._disk_mount_point)

        addons = config.enabled_addons
        gpu_usage_percent, gpu_vram_used_mb = (
            self._gpu.read_usage() if ADDON_GPU in addons else (None, None)
        )

        sample = MetricSample(
            uuid=str(uuid.uuid4()),
            measured_at=utc_now_iso(),
            cpu_percent=self._cpu_percent(),
            # "used" yerine total - available: available, çekirdeğin gerektiğinde
            # uygulamalara verebileceği belleği anlatır (cache dahil geri
            # alınabilir alanlar düşülmüş halde). Çöküş analizinde sorulan soru
            # "makinenin verebileceği bellek kalmış mıydı" olduğu için doğru
            # ölçü budur.
            ram_used_mb=(memory.total - memory.available) // BYTES_PER_MB,
            disk_percent=round(disk.percent, 1),
            temperature_c=_cpu_temperature() if ADDON_TEMPERATURE in addons else None,
            swap_used_mb=_swap_used_mb() if ADDON_SWAP in addons else None,
            **_load_average(enabled=ADDON_LOAD_AVG in addons),
            gpu_usage_percent=gpu_usage_percent,
            gpu_vram_used_mb=gpu_vram_used_mb,
        )

        # memory.percent, ram_used_mb ile aynı tanımı kullanır:
        # (total - available) / total. Yani yüzde ile mutlak değer aynı şeyi
        # iki ölçekte anlatır, biri diğeriyle çelişmez.
        return MetricReading(sample=sample, ram_percent=round(memory.percent, 1))

    def _cpu_percent(self) -> float | None:
        """CPU kullanım yüzdesi — son çağrıdan bu yana geçen süre üzerinden.

        psutil.cpu_percent(interval=None) bloklamaz; iki çağrı arasındaki CPU
        zamanlarını karşılaştırır. İLK çağrının karşılaştıracağı bir taban
        olmadığı için 0.0 döner ve bu bir ölçüm değildir — o örnekte None
        verilir, sonraki her örnek geçerlidir.
        """
        value = psutil.cpu_percent(interval=None)
        if not self._cpu_primed:
            self._cpu_primed = True
            return None
        return round(value, 1)


def _cpu_temperature() -> float | None:
    """CPU sıcaklığı (°C) — bilinen sensörlerden ilk bulunan.

    Tanınan sensör yoksa None döner. "Ne bulursan onu al" DEĞİL, çünkü şemada
    sensör adı için sütun yok: aynı sütuna bir makinede CPU, başka bir
    makinede NVMe diskinin sıcaklığı yazılsaydı sayı karşılaştırılamaz olurdu.

    sensors_temperatures Linux dışında hiç tanımlı değildir; getattr ile
    sorulur, böylece taşınabilirlik tek satırda çözülür.
    """
    reader = getattr(psutil, "sensors_temperatures", None)
    if reader is None:
        return None

    try:
        sensors = reader()
    except (OSError, AttributeError):
        return None

    for name in CPU_SENSOR_NAMES:
        readings = sensors.get(name)
        if readings and readings[0].current is not None:
            return round(readings[0].current, 1)

    return None


def _swap_used_mb() -> int | None:
    """Kullanılan swap (MB). Swap tanımlı değilse 0 döner — bu bir ölçümdür.

    Burada None YALNIZCA okuma başarısız olduğunda döner. Swap'ı olmayan bir
    makinede doğru cevap "ölçülemedi" değil, "sıfır kullanılıyor"dur.
    """
    try:
        return psutil.swap_memory().used // BYTES_PER_MB
    except (OSError, RuntimeError):
        return None


def _load_average(*, enabled: bool) -> dict[str, float | None]:
    """1/5/15 dakikalık yük ortalaması — Linux'a özgü.

    Üç alan tek fonksiyondan çıkar çünkü tek bir çağrının üç parçasıdır;
    birini alıp diğerini alamamak mümkün değil.

    Windows'ta psutil bu değeri taklit eder ama ilk çağrıdan sonra 5 saniye
    boyunca anlamsız değer verir; MVP Linux olduğu için sorun bugün yok,
    yine de hata hali sessizce null'a düşer.
    """
    if not enabled:
        return {"load_avg_1": None, "load_avg_5": None, "load_avg_15": None}

    try:
        one, five, fifteen = psutil.getloadavg()
    except (OSError, AttributeError):
        return {"load_avg_1": None, "load_avg_5": None, "load_avg_15": None}

    return {
        "load_avg_1": round(one, 2),
        "load_avg_5": round(five, 2),
        "load_avg_15": round(fifteen, 2),
    }
