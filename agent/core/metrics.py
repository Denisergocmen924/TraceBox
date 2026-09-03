"""
Ölçüm toplama — psutil ile CPU, RAM, disk ve ağ.

Çekirdek metrikler HER ZAMAN toplanır: cpu_percent, ram_used_mb, disk_percent,
net_sent_mb, net_recv_mb. Eklenti alanları (sıcaklık, swap, load average, GPU)
yalnızca config'in enabled_addons listesinde adı geçiyorsa okunur; kapalıyken
alan null kalır.

Eklentilerin varsayılan olarak KAPALI olmasının sebebi ölçüm maliyeti değil,
anlam maliyetidir: her makinede olmayan bir sütun (sıcaklık sensörü,
NVIDIA GPU, Linux'a özgü load average) açıkça istenmeden doldurulmaz.
"""

from __future__ import annotations

import time
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
# çevrim sabiti kullanmak RAM ve ağ sayılarının aynı ölçekte kalmasını sağlar.
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
    net_sent_mb: float | None
    net_recv_mb: float | None

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
    """Ardışık ölçümler arasında fark gerektiren alanların durumunu tutar.

    CPU yüzdesi ve ağ hızı MUTLAK değerler değildir; ikisi de "önceki ölçümden
    bu yana" hesaplanır. Bu yüzden toplayıcı bir nesnedir: önceki sayaçları
    bellekte taşır. Sayaçlar bilerek state.json'a yazılmaz — agent saatlerce
    kapalı kaldıysa aradaki farkı "hız" diye kaydetmek anlamsız bir ortalama
    üretirdi.
    """

    def __init__(self, disk_mount_point: str = DISK_MOUNT_POINT) -> None:
        self._disk_mount_point = disk_mount_point
        # (bytes_sent, bytes_recv, monotonic zaman) — ilk ölçümde None.
        self._previous_net: tuple[int, int, float] | None = None
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

        Fark gerektiren alanlar (cpu_percent, net_*) hesaplanamadığında None
        döner; çağıran bunu doğrudan null olarak kaydeder. 0.0 yazmak "yük
        yoktu" / "trafik yoktu" anlamına gelirdi ve ölçülemeyen bir anı sıfırla
        karıştırırdı.

        Dönen MetricReading, kaydedilecek örneğin yanında RAM yüzdesini de
        taşır; ikisi de AYNI psutil okumasından çıkar.
        """
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage(self._disk_mount_point)
        net_sent_mb, net_recv_mb = self._network_rates()

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
            net_sent_mb=net_sent_mb,
            net_recv_mb=net_recv_mb,
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

    def _network_rates(self) -> tuple[float | None, float | None]:
        """Ağ trafiğini saniyede MB olarak döndürür (gönderilen, alınan).

        psutil sürekli artan toplam bayt sayacı verir; hız, iki ölçümün farkının
        geçen süreye bölünmesidir. İki durumda hesap yapılamaz ve None döner:
          * ilk ölçüm — karşılaştırılacak önceki sayaç yok,
          * sayacın geriye gitmesi — makine yeniden başlamış ve sayaç sıfırlanmış
            demektir; fark negatif çıkar ve anlamsızdır.

        LOOPBACK HARİÇ (`lo`). psutil.net_io_counters() varsayılan olarak tüm
        arayüzleri toplar ve loopback da bunlara dâhildir; oysa `lo` üzerindeki
        trafik makinenin kendi içinde kalır, ağa hiç çıkmaz. Aynı bayt hem
        gönderilen hem alınan olarak sayıldığı için ölçüm iki kez şişerdi:
        yerel bir veritabanına konuşan bir uygulama, ağ kartı boşken bile
        grafikte megabitler gösterirdi. Kullanıcının sorusu "bu makine ağı ne
        kadar kullanıyor" — cevabın içine makinenin kendi kendine konuşması
        girmemeli.
        """
        totals = self._external_bytes()
        now = time.monotonic()
        previous = self._previous_net

        if totals is None:
            # Arayüz listesi okunamadı. Sayaç DA sıfırlanır: eski tabanı
            # saklasaydık, okuma geri geldiğinde arada geçen tüm süre tek bir
            # örneğe sıkışır ve sahte bir sıçrama olarak çizilirdi.
            self._previous_net = None
            return None, None

        sent, recv = totals

        # Sayaçlar her durumda güncellenir: hesap yapılamayan bir ölçüm bile
        # bir SONRAKİ ölçümün tabanı olur.
        self._previous_net = (sent, recv, now)

        if previous is None:
            return None, None

        previous_sent, previous_recv, previous_time = previous
        elapsed = now - previous_time
        if elapsed <= 0:
            return None, None
        if sent < previous_sent or recv < previous_recv:
            return None, None

        sent_rate = (sent - previous_sent) / BYTES_PER_MB / elapsed
        recv_rate = (recv - previous_recv) / BYTES_PER_MB / elapsed
        return round(sent_rate, 3), round(recv_rate, 3)

    @staticmethod
    def _external_bytes() -> tuple[int, int] | None:
        """Loopback dışındaki arayüzlerin toplam gönderilen/alınan baytı.

        Arayüz adı `lo` ile başlıyorsa atlanır: Linux'ta `lo`, ağ ad alanı
        kullanan kurulumlarda `lo0`/`lo1` da görülebilir. Ad üzerinden eleme
        kaba bir ölçüt ama psutil arayüzün türünü söylemiyor; alternatif,
        her platform için ayrı bir sistem çağrısı yazmak olurdu.

        Sayaç geri toplandığı için, ARAYÜZ SAYISI DEĞİŞİRSE (bir VPN kalkar,
        bir kapsayıcı köprüsü inerse) toplam geriye gidebilir. Bu, çağıranın
        zaten ele aldığı "sayaç geriye gitti" durumuna düşer: o örnek atlanır,
        bir sonraki yeni tabandan hesaplanır.
        """
        try:
            per_nic = psutil.net_io_counters(pernic=True)
        except (OSError, RuntimeError):
            return None

        sent = 0
        recv = 0
        for name, counters in per_nic.items():
            if name.lower().startswith("lo"):
                continue
            sent += counters.bytes_sent
            recv += counters.bytes_recv
        return sent, recv


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
