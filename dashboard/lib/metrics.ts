/**
 * Zaman çizelgesinin veri katmanı (CLAUDE.md §9.6–§9.7).
 *
 * Buradaki tek büyük fikir: HAM VERİ İNMEZ. Agent 5 saniyede bir ölçüyor, yani
 * tek cihazda 10 gün ≈ 173.000 satır. Grafik ise ~1200 piksel geniş; satırların
 * neredeyse tamamı zaten çizilemez. Bu yüzden seyreltmeyi veritabanı yapıyor
 * (db/migrations/0004_metrics_buckets.sql): aralık ~1000 kovaya bölünür, her
 * kovadan min / max / ortalama döner. Hangi aralığa bakılırsa bakılsın ekrana
 * aynı boyutta veri iner — 1 saat de 10 gün de aynı hızda açılır.
 *
 * Ortalama TEK BAŞINA kullanılmaz (§9.6 madde 6). 15 dakikalık bir kovanın
 * ortalaması, 5 saniyelik bir CPU patlamasını yutar; o patlamayı görebilmek bu
 * projenin varlık sebebi. Grafikte bant min–max, içinden geçen çizgi ortalama.
 * Yalnızca max çizmek de bir tür yalan olurdu: makineyi olduğundan yoğun
 * gösterirdi.
 */
import type { LatestMetric } from "./devices";
import { supabase } from "./supabase";

/** SQL fonksiyonunun döndürdüğü satır. Alan adları birebir aynı. */
export type MetricBucket = {
  bucket_start: string;
  samples: number;
  cpu_min: number | null;
  cpu_max: number | null;
  cpu_avg: number | null;
  ram_min: number | null;
  ram_max: number | null;
  ram_avg: number | null;
  disk_min: number | null;
  disk_max: number | null;
  disk_avg: number | null;
};

/**
 * Kaç kova isteneceği. ~1000 ekranın çözünürlüğüne oranlı sayı (§9.6 madde 4);
 * fonksiyonun kendi tavanı 5000, yani bu değer büyütülse bile veritabanı
 * korunuyor.
 */
export const BUCKET_COUNT = 1000;

/**
 * Agent'ın ACİL GÖNDERİM eşikleri (agent/config.example.toml: cpu 90, ram 90,
 * disk 95). Grafikte kesik çizgi olarak duruyorlar, çünkü o çizginin üstü
 * keyfi bir "tehlike" tanımı değil: agent orada spool'u beklemeden anında
 * boşaltır. Kart ekranındaki çubuk renkleri de aynı sayıları kullanır — iki
 * ekranın iki ayrı tehlike tanımı olsaydı kullanıcıyı yanıltırdı.
 */
export const FLUSH_THRESHOLD = { cpu: 90, ram: 90, disk: 95 } as const;

/**
 * Sayı biçimlendirme burada, SERIES tanımının ÜSTÜNDE duruyor: SERIES bir
 * `const` ve içindeki oklar bu iki yardımcıyı çağırıyor. Aşağıda tanımlansalar
 * modül yüklenirken henüz kurulmamış olurlardı.
 */
function tr(value: number, digits = 1): string {
  return value.toLocaleString("tr-TR", { maximumFractionDigits: digits });
}

/** 6820 → "6,7 GB". Kartta MB yazmak okunaksız. */
function gbShort(mb: number | null | undefined): string {
  return mb == null ? "—" : `${tr(mb / 1024)} GB`;
}

export type MetricKey = "cpu" | "ram" | "disk";

/** Bir kovanın tek bir ölçü için üç değeri. */
export type Band = {
  min: number | null;
  max: number | null;
  avg: number | null;
};

/**
 * Bir ölçünün TAM tanımı: adı, birimi, rengi, kovadan nasıl okunacağı ve son
 * metrik satırından yüzdeye nasıl çevrileceği.
 *
 * Liste ekranındaki çubuk da, detaydaki grafik de, zildeki uyarı da buradan
 * besleniyor. Daha önce üçü ayrı ayrı biliyordu: RAM yüzdesi iki dosyada iki
 * kez hesaplanıyor, renk üçüncü bir dosyada seçiliyordu. Bir ölçü eklendiğinde
 * (ör. ağ) üç yeri birden hatırlamak gerekirdi.
 *
 * Renkler HAZIR SINIF ADI olarak duruyor, `stroke-${key}` gibi kurulmuyor:
 * Tailwind kaynak dosyalarını metin olarak tarıyor ve çalışma anında birleşen
 * bir sınıf adını göremez — üretim derlemesinde o renk CSS'e hiç girmezdi.
 */
export type SeriesDef = {
  key: MetricKey;
  label: string;
  /** percent → y ekseni SABİT 0–100; mb → tavan cihazın toplam RAM'i. */
  unit: "percent" | "mb";
  /** Tasarım planı §2: indigo primary, violet secondary, cyan I/O. */
  tone: {
    line: string;
    band: string;
    bar: string;
    text: string;
    chip: string;
  };
  pick: (bucket: MetricBucket) => Band;
  /** Son metrik satırından 0–100 oranı; ölçülmediyse null. */
  percent: (m: LatestMetric, ramTotalMb: number | null) => number | null;
  /** Son metrik satırının okunur hâli — kartın sağındaki yazı. */
  display: (m: LatestMetric, ramTotalMb: number | null) => string;
};

export const SERIES: SeriesDef[] = [
  {
    key: "cpu",
    label: "CPU",
    unit: "percent",
    tone: {
      line: "stroke-cpu",
      band: "fill-cpu/15",
      bar: "bg-cpu",
      text: "text-cpu",
      chip: "bg-cpu/10 text-cpu",
    },
    pick: (b) => ({ min: b.cpu_min, max: b.cpu_max, avg: b.cpu_avg }),
    percent: (m) => m.cpu_percent,
    display: (m) => (m.cpu_percent == null ? "—" : `${tr(m.cpu_percent, 0)}%`),
  },
  {
    key: "ram",
    label: "RAM",
    unit: "mb",
    tone: {
      line: "stroke-ram",
      band: "fill-ram/15",
      bar: "bg-ram",
      text: "text-ram",
      chip: "bg-ram/10 text-ram",
    },
    pick: (b) => ({ min: b.ram_min, max: b.ram_max, avg: b.ram_avg }),
    // RAM tek başına bir oran değil: 6 GB kullanım 8 GB'lık makinede kritik,
    // 64 GB'lıkta sıradan. Oran ancak envanterle birlikte anlam kazanıyor.
    percent: (m, total) =>
      m.ram_used_mb != null && total ? (m.ram_used_mb / total) * 100 : null,
    display: (m, total) =>
      m.ram_used_mb == null
        ? "—"
        : `${gbShort(m.ram_used_mb)} / ${gbShort(total)}`,
  },
  {
    key: "disk",
    label: "Disk",
    unit: "percent",
    tone: {
      line: "stroke-disk",
      band: "fill-disk/15",
      bar: "bg-disk",
      text: "text-disk",
      chip: "bg-disk/10 text-disk",
    },
    pick: (b) => ({ min: b.disk_min, max: b.disk_max, avg: b.disk_avg }),
    percent: (m) => m.disk_percent,
    display: (m) => (m.disk_percent == null ? "—" : `${tr(m.disk_percent, 0)}%`),
  },
];

/** SERIES'i anahtarla aramak için — uyarılar ve rozetler tek ölçüye bakıyor. */
export const SERIES_BY_KEY: Record<MetricKey, SeriesDef> = Object.fromEntries(
  SERIES.map((s) => [s.key, s]),
) as Record<MetricKey, SeriesDef>;

/* --- Çekme ---------------------------------------------------------------- */

/**
 * Üç ölçünün üçü de TEK istekle geliyor: fonksiyon zaten hepsini birlikte
 * döndürüyor. Üç ayrı çağrı yapmak aynı satırları üç kez taratmak olurdu ve
 * grafikler birbirinden farklı anlara ait olabilirdi.
 */
export async function fetchBuckets(params: {
  deviceId: string;
  fromMs: number;
  toMs: number;
  buckets?: number;
}): Promise<MetricBucket[]> {
  const { data, error } = await supabase().rpc("metrics_buckets", {
    p_device_id: params.deviceId,
    p_from: new Date(params.fromMs).toISOString(),
    p_to: new Date(params.toMs).toISOString(),
    p_buckets: params.buckets ?? BUCKET_COUNT,
  });

  if (error) throw error;
  return (data ?? []) as MetricBucket[];
}

/* --- Çizime hazırlık ------------------------------------------------------ */

export type Point = { t: number; min: number; max: number; avg: number };

/**
 * Kovaları noktalara çevirir. Üç değerden biri bile null olan kova ATLANIR:
 * eklenti kapalıysa (§4.2) sütun boş gelir ve 0 kabul etmek "kullanım sıfırdı"
 * demek olurdu — oysa doğrusu "ölçülmedi".
 */
export function toPoints(buckets: MetricBucket[], series: SeriesDef): Point[] {
  const points: Point[] = [];
  for (const bucket of buckets) {
    const { min, max, avg } = series.pick(bucket);
    if (min == null || max == null || avg == null) continue;
    points.push({ t: Date.parse(bucket.bucket_start), min, max, avg });
  }
  return points;
}

/**
 * İki komşu nokta arası bu katsayıdan fazlaysa arada VERİ YOK demektir.
 * 1.5: bir kovalık boşluk yuvarlama payı, ikisi gerçek boşluk.
 */
export const GAP_FACTOR = 1.5;

/**
 * Boşlukları ayırır. SQL fonksiyonu boş kova döndürmüyor (cihazın kapalı
 * olduğu 9 gün için 900 boş satır taşımak anlamsızdı); boşluğu iki komşu
 * kovanın zaman farkından burada çıkarıyoruz.
 *
 * Ayrılmasaydı grafik, cihazın kapalı olduğu günün üzerinden düz bir çizgi
 * geçirir ve o boyunca veri varmış gibi gösterirdi.
 */
export function splitOnGaps(points: Point[], widthMs: number): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];

  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && point.t - previous.t > widthMs * GAP_FACTOR) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

export function bucketWidthMs(fromMs: number, toMs: number, count: number): number {
  return Math.max(1, (toMs - fromMs) / count);
}

/**
 * Y ekseninin tavanı.
 *
 * Yüzdelerde SABİT 100 — veriye göre ölçeklenseydi %2 ile %3 arasında gezinen
 * boş bir makine, ekranı dolduran bir dağ gibi görünürdü. Grafiğin yüksekliği
 * her zaman aynı şeyi ifade etmeli.
 *
 * RAM'de tavan cihazın toplam RAM'i (künyeden). Envanter hiç gelmediyse
 * gözlenen en yüksek değere düşülür — o durumda oran anlamını yitirir ama
 * grafik yine de çizilir.
 */
export function ceilingFor(
  series: SeriesDef,
  ramTotalMb: number | null,
  points: Point[],
): number {
  if (series.unit === "percent") return 100;
  if (ramTotalMb) return ramTotalMb;
  const observed = Math.max(0, ...points.map((p) => p.max));
  return observed > 0 ? observed : 1;
}

/** Ölçünün eşik çizgisi, y ekseninin biriminde. */
export function thresholdFor(series: SeriesDef, ceiling: number): number {
  const percent = FLUSH_THRESHOLD[series.key];
  return series.unit === "percent" ? percent : (ceiling * percent) / 100;
}

/* --- Biçimlendirme -------------------------------------------------------- */

/** 86400000 → "1 gün", 154000 → "2,6 dakika". Kova genişliğini yazmak için. */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 90) return `${tr(seconds)} saniye`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${tr(minutes)} dakika`;
  const hours = minutes / 60;
  if (hours < 36) return `${tr(hours)} saat`;
  return `${tr(hours / 24)} gün`;
}

export function formatValue(series: SeriesDef, value: number): string {
  if (series.unit === "percent") return `${tr(value, 0)}%`;
  return value >= 1024 ? `${tr(value / 1024)} GB` : `${tr(value, 0)} MB`;
}

/**
 * İmlecin altındaki kova. Kovalar zaman sırasında olduğu için ikili arama;
 * 1000 nokta üzerinde her fare hareketinde doğrusal tarama yapmak, kaydırma
 * sırasında hissedilir bir takılma üretirdi.
 */
export function nearestIndex(buckets: MetricBucket[], t: number): number | null {
  if (buckets.length === 0) return null;

  let low = 0;
  let high = buckets.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (Date.parse(buckets[mid].bucket_start) < t) low = mid + 1;
    else high = mid;
  }

  // İkili arama t'den küçük OLMAYAN ilk kovayı bulur; bir öncekinin ona
  // gerçekten daha yakın olması hâlâ mümkün.
  const previous = low - 1;
  if (previous < 0) return low;
  const here = Math.abs(Date.parse(buckets[low].bucket_start) - t);
  const before = Math.abs(Date.parse(buckets[previous].bucket_start) - t);
  return before <= here ? previous : low;
}
