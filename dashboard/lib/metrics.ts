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
  /*
   * Ağ sütunları migration 0005 ile geldi ve OPSİYONEL yazıldı: 0005 henüz
   * çalıştırılmadıysa fonksiyon bu sütunları hiç döndürmez ve alan `undefined`
   * olur. Zorunlu yazılsaydı TypeScript "var" derdi ama çalışma anında yoktu;
   * opsiyonel olunca ağ mini grafiği sessizce boş kalıyor, ekranın geri kalanı
   * çalışmaya devam ediyor.
   */
  net_sent_min?: number | null;
  net_sent_max?: number | null;
  net_sent_avg?: number | null;
  net_recv_min?: number | null;
  net_recv_max?: number | null;
  net_recv_avg?: number | null;
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
function num(value: number, digits = 1): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: digits });
}

/** 6820 → "6.7 GB". Kartta MB yazmak okunaksız. */
function gbShort(mb: number | null | undefined): string {
  return mb == null ? "—" : `${num(mb / 1024)} GB`;
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
    display: (m) => (m.cpu_percent == null ? "—" : `${num(m.cpu_percent, 0)}%`),
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
    display: (m) => (m.disk_percent == null ? "—" : `${num(m.disk_percent, 0)}%`),
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
 * Noktalar arasındaki TİPİK mesafe — medyan.
 *
 * Ortalama değil medyan: cihazın kapalı kaldığı dokuz günlük tek bir boşluk,
 * ortalamayı tek başına yukarı çeker ve gerçek boşlukları görünmez yapardı.
 * Medyan o tek uç değerden etkilenmiyor.
 */
export function typicalSpacingMs(points: Point[]): number | null {
  if (points.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    deltas.push(points[i].t - points[i - 1].t);
  }
  deltas.sort((a, b) => a - b);
  return deltas[deltas.length >> 1];
}

/**
 * Boşluk eşiği.
 *
 * İstenen kova genişliği TEK BAŞINA ölçüt olamaz. Yakınlaştırıldıkça aralık
 * daralıyor ve genişlik 1000'e bölündüğü için milisaniyelere iniyor — oysa
 * agent beş saniyede bir ölçüyor, yani kovaların çoğu tek örnek taşıyor ve
 * komşuları beş saniye uzakta kalıyor. Eşik yalnızca kova genişliğine
 * bakarsaydı bu normal mesafe "boşluk" sayılır, her nokta tek başına bir
 * parçaya düşer ve tek noktalı parçadan çizgi çizilemediği için GRAFİK
 * TAMAMEN KAYBOLURDU. (2026-08-31'de tam olarak bu yaşandı.)
 *
 * Bu yüzden ölçüt ikisinin büyüğü: istenen kova genişliği ile verinin kendi
 * tipik aralığı. Seyrek bakışta ilki, yakınlaştırılmış bakışta ikincisi
 * belirleyici oluyor.
 */
export function gapThresholdMs(points: Point[], widthMs: number): number {
  const typical = typicalSpacingMs(points);
  return Math.max(widthMs, typical ?? widthMs) * GAP_FACTOR;
}

/**
 * Boşlukları ayırır. SQL fonksiyonu boş kova döndürmüyor (cihazın kapalı
 * olduğu 9 gün için 900 boş satır taşımak anlamsızdı); boşluğu iki komşu
 * kovanın zaman farkından burada çıkarıyoruz.
 *
 * Ayrılmasaydı grafik, cihazın kapalı olduğu günün üzerinden düz bir çizgi
 * geçirir ve o boyunca veri varmış gibi gösterirdi.
 */
export function splitOnGaps(points: Point[], widthMs: number): Point[][] {
  const limit = gapThresholdMs(points, widthMs);
  const segments: Point[][] = [];
  let current: Point[] = [];

  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && point.t - previous.t > limit) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

/**
 * Ölçüyü ortak 0–100 eksenine taşıyan çarpan; taşınamıyorsa null.
 *
 * Referans 2'nin "System Metrics" grafiği üç ölçüyü TEK eksende üst üste
 * çiziyor ve RAM'i de yüzde olarak gösteriyor. Bunun için toplam RAM gerekli:
 * 6 GB kullanım 8 GB'lık makinede kritik, 64 GB'lıkta sıradan. Envanter hiç
 * gelmediyse oran kurulamıyor ve RAM çizgisi grafikten düşüyor — uydurma bir
 * tavanla çizmek, kullanıcıya yanlış bir doluluk göstermek olurdu.
 */
export function percentScale(
  series: SeriesDef,
  ramTotalMb: number | null,
): number | null {
  if (series.unit === "percent") return 1;
  if (ramTotalMb && ramTotalMb > 0) return 100 / ramTotalMb;
  return null;
}

/* --- Çizim izleri (Chart'ın tek girdisi) ---------------------------------- */

/**
 * Grafikte çizilen TEK bir çizgi.
 *
 * Chart artık ne CPU'yu ne ağı tanıyor; yalnızca "iz" (track) çiziyor. Sebep
 * ağ grafiğinin gelmesiydi: donanım grafiğinin ekseni SABİT 0–100 iken ağın
 * tavanı yok (bkz. §9.6 madde 1'in yüzde tarafı) ve birimi büyüklüğe göre
 * Mbps/Kbps arasında değişiyor. İkinci bir grafik bileşeni yazmak, sürükleme,
 * imleç, boşluk ayırma ve eksen mantığını ikinci kez yazmak olurdu — biri
 * düzeltilip diğeri unutulurdu.
 */
export type Track = {
  key: string;
  label: string;
  /** Hazır sınıf adları — Tailwind şablon birleştirme göremiyor. */
  tone: { line: string; band: string; bar: string };
  /**
   * Çizgi kesikli çizilsin mi.
   *
   * Renk tek başına yetmediği için var: gelen ve giden trafik çoğu zaman
   * BİREBİR aynı değerde (agent düzenli aralıklarla küçük bir POST atıp küçük
   * bir GET yapıyor), iki çizgi tam üst üste biniyor ve SVG'de sonra çizilen
   * öncekini tamamen örtüyor. Kesikli çizgi boşluklarından alttaki çizgiyi
   * gösteriyor. Yan fayda: renk körü bir kullanıcı için ikinci bir sinyal.
   */
  dashed?: boolean;
  /** Değeri ORTAK y eksenine taşıyan çarpan (yüzde ekseninde RAM için 100/total). */
  scale: number;
  /** Ölçeklenmiş, boşluklarından ayrılmış parçalar — geometri buradan. */
  segments: Point[][];
  /** Kovadan HAM değer — imleç okuması ölçünün kendi biriminde yazılıyor. */
  pick: (bucket: MetricBucket) => Band;
  /** Ham değerin okunur hâli. */
  format: (value: number) => string;
};

function buildSegments(points: Point[], scale: number, widthMs: number) {
  const scaled =
    scale === 1
      ? points
      : points.map((p) => ({
          t: p.t,
          min: p.min * scale,
          max: p.max * scale,
          avg: p.avg * scale,
        }));
  return splitOnGaps(scaled, widthMs);
}

/**
 * CPU / RAM / Disk — hepsi ORTAK yüzde ekseninde.
 *
 * RAM yüzdeye çevrilemiyorsa (envanter hiç gelmemiş) iz LİSTEYE GİRMİYOR:
 * uydurma bir tavanla çizmek yanlış bir doluluk göstermek olurdu. Çağıran
 * eksik izi fark edip kullanıcıya sebebini yazıyor.
 */
export function hardwareTracks(
  buckets: MetricBucket[],
  ramTotalMb: number | null,
  widthMs: number,
): Track[] {
  const tracks: Track[] = [];
  for (const def of SERIES) {
    const scale = percentScale(def, ramTotalMb);
    if (scale == null) continue;

    const points = toPoints(buckets, def);
    if (points.length === 0) continue;

    tracks.push({
      key: def.key,
      label: def.label,
      tone: def.tone,
      scale,
      segments: buildSegments(points, scale, widthMs),
      pick: def.pick,
      format: (v) => formatValue(def, v),
    });
  }
  return tracks;
}

/**
 * Gelen / giden ağ trafiği — donanımdan AYRI bir grafik.
 *
 * Ayrı olmasının sebebi eksen: CPU, RAM ve disk hepsi bir yüzdedir ve %100
 * hepsi için aynı şeyi anlatır. Ağın tavanı yoktur — 5 Mbps bir hatta çok, bir
 * başkasında hiçbir şeydir. Aynı eksene konsaydı ya ağ dümdüz sıfır çizgisi
 * olurdu (yüzdeler yanında ölçeksiz kalırdı) ya da yüzdeler ezilirdi.
 *
 * Birim İKİ İZ İÇİN ORTAK ve tepe değerden seçiliyor: gelen Mbps, giden Kbps
 * yazsaydı yan yana duran iki çizgi karşılaştırılamazdı.
 *
 * Renkler: gelen MAVİ, giden MAGENTA (globals.css). İkisi de soğuk aileden
 * (mavi + camgöbeği) seçilmişti; agent'ın trafiği testere dişi gibi olduğu
 * için çizgiler sürekli kesişiyor ve o iki ton ayırt edilemiyordu.
 */
export function networkTracks(
  buckets: MetricBucket[],
  widthMs: number,
): { tracks: Track[]; scale: BitrateScale } {
  const defs = [
    {
      key: "net_recv",
      label: "In",
      tone: { line: "stroke-net", band: "fill-net/15", bar: "bg-net" },
      dashed: false,
      pick: (b: MetricBucket): Band => ({
        min: b.net_recv_min ?? null,
        max: b.net_recv_max ?? null,
        avg: b.net_recv_avg ?? null,
      }),
    },
    {
      key: "net_sent",
      label: "Out",
      tone: {
        line: "stroke-net-out",
        band: "fill-net-out/15",
        bar: "bg-net-out",
      },
      dashed: true,
      pick: (b: MetricBucket): Band => ({
        min: b.net_sent_min ?? null,
        max: b.net_sent_max ?? null,
        avg: b.net_sent_avg ?? null,
      }),
    },
  ];

  const collected = defs.map((def) => ({
    def,
    points: pointsFrom(buckets, def.pick),
  }));

  const peak = Math.max(
    0,
    ...collected.flatMap((c) => c.points.map((p) => p.max)),
  );
  const scale = bitrateScale(peak);

  const tracks = collected
    .filter((c) => c.points.length > 0)
    .map(({ def, points }) => ({
      key: def.key,
      label: def.label,
      tone: def.tone,
      dashed: def.dashed,
      scale: 1,
      segments: buildSegments(points, 1, widthMs),
      pick: def.pick,
      format: (v: number) => formatBitrate(v, scale),
    }));

  /*
   * Ölçek dışarı da veriliyor: y ekseni etiketleri ("1.2 Mbps") aynı birimi
   * kullanmak zorunda. Çağıran tepeyi yeniden hesaplasaydı iki ayrı yuvarlama
   * çıkabilir, eksen ile gösterge farklı birim yazabilirdi.
   */
  return { tracks, scale };
}

/**
 * İzlerin y ekseni tavanı — yüzdelerde SABİT 100, serbest eksende gözlenen en
 * yüksek değerin biraz üstü.
 *
 * Baş boşluğu (%15) olmasaydı tepe nokta grafiğin en üst çizgisine yapışır ve
 * kırpılmış gibi görünürdü. Hiç veri yoksa 1: sıfıra bölmeyi önlüyor.
 */
export function tracksCeiling(tracks: Track[]): number {
  const observed = Math.max(
    0,
    ...tracks.flatMap((t) => t.segments.flatMap((s) => s.map((p) => p.max))),
  );
  return observed > 0 ? observed * 1.15 : 1;
}

/** toPoints'in SeriesDef'e bağlı olmayan hâli — ağ izleri için. */
function pointsFrom(
  buckets: MetricBucket[],
  pick: (b: MetricBucket) => Band,
): Point[] {
  const points: Point[] = [];
  for (const bucket of buckets) {
    const { min, max, avg } = pick(bucket);
    if (min == null || max == null || avg == null) continue;
    points.push({ t: Date.parse(bucket.bucket_start), min, max, avg });
  }
  return points;
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
  if (seconds < 90) return `${num(seconds)} seconds`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${num(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 36) return `${num(hours)} hours`;
  return `${num(hours / 24)} days`;
}

export function formatValue(series: SeriesDef, value: number): string {
  if (series.unit === "percent") return `${num(value, 0)}%`;
  return value >= 1024 ? `${num(value / 1024)} GB` : `${num(value, 0)} MB`;
}

/** "23%", ölçüm yoksa çağıran "—" yazar. Yüzde işareti SONRA — ürün İngilizce. */
export function formatPercent(value: number, digits = 0): string {
  return `${num(value, digits)}%`;
}

/** Bayt → bit. Ağ hızları geleneksel olarak bit cinsinden konuşulur. */
const BITS_PER_BYTE = 8;

/** 1 Mbit = 1000 kbit. Ağda ölçek ondalık, ikilik değil. */
const KBIT_PER_MBIT = 1000;

export type BitrateScale = {
  unit: string;
  /** MB/s → seçilen birim. */
  factor: number;
  digits: number;
};

/**
 * Bir TEPE değere bakıp o veri kümesinin tamamının konuşacağı birimi seçer.
 *
 * Ölçek tek bir yerden çıkıyor çünkü aynı grafikte y ekseni etiketleri,
 * çizgiler ve imleç okuması AYNI birimi kullanmak zorunda. Her biri kendi
 * eşiğine baksaydı eksen "Kbps" derken imleç "0.0 Mbps" gösterebilirdi.
 */
export function bitrateScale(peakMbPerSecond: number): BitrateScale {
  const peakMbit = Math.max(0, peakMbPerSecond) * BITS_PER_BYTE;
  const useMbit = peakMbit >= 1;
  const factor = useMbit ? BITS_PER_BYTE : BITS_PER_BYTE * KBIT_PER_MBIT;
  return {
    unit: useMbit ? "Mbps" : "Kbps",
    factor,
    digits: peakMbPerSecond * factor >= 10 ? 0 : 1,
  };
}

/** Tek bir oranı, verilen ölçekte, birimiyle birlikte yazar. */
export function formatBitrate(
  mbPerSecond: number,
  scale: BitrateScale,
): string {
  return `${num(mbPerSecond * scale.factor, scale.digits)} ${scale.unit}`;
}

export type BitratePair = { sent: string; recv: string; unit: string };

/**
 * İki ağ oranını (agent'ın birimi: saniyede MB) okunur bit hızına çevirir.
 *
 * BİRİM ORTAK ve iki sayının BÜYÜĞÜNE göre seçiliyor. Her sayı kendi birimini
 * seçseydi kart "1.2 Mbps / 340 Kbps" yazardı; yan yana duran iki sayıyı
 * karşılaştırmak için okuyucunun önce birimleri zihninde eşitlemesi gerekirdi.
 * Ortak birimde 1.2 ile 0.3 anında karşılaştırılıyor.
 *
 * KBPS'E DÜŞEBİLMESİ ŞART. Önceki hâl her şeyi Mbps'te bir ondalıkla yazıyordu
 * ve boştaki bir makinenin tek trafiği agent'ın kendi telemetrisi — 30 saniyede
 * bir küçük bir POST, 10 saniyede bir küçük bir GET, toplamda ~2 Kbps. Bu,
 * 0.002 Mbps eder ve bir ondalığa yuvarlanınca "0.0" olur. Ekran, çalışan bir
 * ölçümü BOZUK gibi gösteriyordu: kullanıcı "ağ neden hep sıfır" diye sordu ve
 * haklıydı — sayı sıfır değildi, biçimlendirici onu sıfıra indiriyordu.
 * Gerçekten sıfır olan bir değeri sıfır göstermek doğru; küçük olanı sıfır
 * göstermek §9.6 madde 5'in yasakladığı sessiz yalan.
 *
 * Ondalık basamak da büyüklüğe göre: 340 Kbps'te ondalık gürültü, 1.2 Mbps'te
 * bilgi.
 */
export function formatBitratePair(
  sentMbPerSecond: number,
  recvMbPerSecond: number,
): BitratePair {
  const scale = bitrateScale(Math.max(sentMbPerSecond, recvMbPerSecond));
  return {
    sent: num(sentMbPerSecond * scale.factor, scale.digits),
    recv: num(recvMbPerSecond * scale.factor, scale.digits),
    unit: scale.unit,
  };
}

/**
 * Saniyede MB → Mbit/s. Sayı olarak gerekiyor (grafik ölçeği); metin
 * gerekiyorsa formatBitratePair kullanılır.
 */
export function mbpsFromMbPerSecond(value: number): number {
  return value * BITS_PER_BYTE;
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
