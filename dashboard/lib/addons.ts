/**
 * Eklenti ölçülerinin grafikleri (agent `enabled_addons`, CLAUDE.md §4.3).
 *
 * Her eklenti kendi TÜRÜNE göre gösterilir: zaman serisi olanlar (sıcaklık,
 * swap, yük ortalaması, GPU) grafik olur; zaman serisi olmayanlar (`external_ip`
 * tek bir değer, `crash_processes` ayrı bir tablo) burada YOK — onlar künyede
 * ve çöküş işaretlerinde zaten gösteriliyor.
 *
 * Bir grafik YALNIZCA cihazın `enabled_addons` listesi o eklentiyi içeriyorsa
 * çıkar. Kapatılmış bir eklentinin eski verisi bu yüzden gizlenir; bilinçli
 * bir tercih (bkz. md/memory/decisions.md → "Eklenti grafikleri").
 *
 * Çizim donanım ve ağ grafikleriyle AYNI yoldan geçer: iz (Track) üretilir,
 * MetricChart çizer. Burada ikinci bir çizim mantığı yok.
 */
import {
  buildSegments,
  formatPercent,
  num,
  pointsFrom,
  tracksCeiling,
  type Band,
  type MetricBucket,
  type Track,
} from "./metrics";

/** Eklenti adları — agent/core/config.py ile birebir aynı. */
export type AddonName = "temperature" | "swap" | "load_avg" | "gpu";

/** Bir panelin tek çizgisi; `prefix` kovadaki `${prefix}_min|max|avg` sütunları. */
type TrackDef = {
  key: string;
  label: string;
  prefix: string;
  /** Hazır sınıf adları — Tailwind çalışma anında birleşen adı göremez. */
  tone: Track["tone"];
  dashed?: boolean;
};

type PanelDef = {
  key: string;
  addon: AddonName;
  title: string;
  subtitle: string;
  tracks: TrackDef[];
  /** Y ekseni tavanı: yüzdede sabit 100, diğerlerinde gözlenen tepe + pay. */
  fixedCeiling?: number;
  format: (value: number) => string;
};

export type AddonPanel = {
  key: string;
  title: string;
  subtitle: string;
  tracks: Track[];
  ceiling: number;
  formatAxis: (value: number) => string;
};

/** MB değerini okunur yazar: 1536 → "1.5 GB". */
function formatMegabytes(value: number): string {
  return value >= 1024 ? `${num(value / 1024)} GB` : `${num(value, 0)} MB`;
}

const PANELS: PanelDef[] = [
  {
    key: "temperature",
    addon: "temperature",
    title: "Temperature",
    subtitle: "CPU package temperature",
    tracks: [
      {
        key: "temp",
        label: "Temp",
        prefix: "temp",
        tone: { line: "stroke-temp", band: "fill-temp/15", bar: "bg-temp" },
      },
    ],
    format: (v) => `${num(v, 0)} °C`,
  },
  {
    key: "swap",
    addon: "swap",
    title: "Swap",
    subtitle: "swap space in use",
    tracks: [
      {
        key: "swap",
        label: "Swap",
        prefix: "swap",
        tone: { line: "stroke-swap", band: "fill-swap/15", bar: "bg-swap" },
      },
    ],
    format: formatMegabytes,
  },
  {
    key: "load_avg",
    addon: "load_avg",
    title: "Load average",
    subtitle: "runnable processes, 1 / 5 / 15 minute averages",
    tracks: [
      {
        key: "load1",
        label: "1 min",
        prefix: "load1",
        tone: { line: "stroke-load", band: "fill-load/15", bar: "bg-load" },
      },
      {
        key: "load5",
        label: "5 min",
        prefix: "load5",
        tone: {
          line: "stroke-load-5",
          band: "fill-load-5/15",
          bar: "bg-load-5",
        },
        // Üç çizgi birbirine çok yakın seyredebilir; kesik çizgi alttakini
        // gösteriyor (ağ grafiğindeki gelen/giden ile aynı gerekçe).
        dashed: true,
      },
      {
        key: "load15",
        label: "15 min",
        prefix: "load15",
        tone: {
          line: "stroke-load-15",
          band: "fill-load-15/15",
          bar: "bg-load-15",
        },
      },
    ],
    format: (v) => num(v, 2),
  },
  {
    key: "gpu_usage",
    addon: "gpu",
    title: "GPU usage",
    subtitle: "graphics processor utilisation",
    tracks: [
      {
        key: "gpu_usage",
        label: "GPU",
        prefix: "gpu_usage",
        tone: { line: "stroke-gpu", band: "fill-gpu/15", bar: "bg-gpu" },
      },
    ],
    fixedCeiling: 100,
    format: (v) => formatPercent(v),
  },
  {
    key: "gpu_vram",
    addon: "gpu",
    title: "GPU memory",
    subtitle: "video memory in use",
    tracks: [
      {
        key: "gpu_vram",
        label: "VRAM",
        prefix: "gpu_vram",
        tone: { line: "stroke-gpu", band: "fill-gpu/15", bar: "bg-gpu" },
      },
    ],
    format: formatMegabytes,
  },
];

/** Kovadan `${prefix}_min|max|avg` üçlüsünü okur. */
function pickBand(prefix: string) {
  return (bucket: MetricBucket): Band => {
    const b = bucket as unknown as Record<string, number | null | undefined>;
    return {
      min: b[`${prefix}_min`] ?? null,
      max: b[`${prefix}_max`] ?? null,
      avg: b[`${prefix}_avg`] ?? null,
    };
  };
}

/**
 * Cihazın AÇIK eklentilerine karşılık gelen grafik panelleri.
 *
 * Eklenti açık ama pencerede hiç örnek yoksa panel yine döner ve `tracks`
 * boş olur: çağıran "bu aralıkta örnek yok" yazar. Paneli düşürmek, kullanıcının
 * açtığı eklentinin neden görünmediğini açıklamasız bırakırdı.
 */
export function addonPanels(
  buckets: MetricBucket[],
  enabledAddons: readonly string[],
  widthMs: number,
): AddonPanel[] {
  const panels: AddonPanel[] = [];

  for (const def of PANELS) {
    if (!enabledAddons.includes(def.addon)) continue;

    const tracks: Track[] = [];
    for (const t of def.tracks) {
      const pick = pickBand(t.prefix);
      const points = pointsFrom(buckets, pick);
      if (points.length === 0) continue;
      tracks.push({
        key: t.key,
        label: t.label,
        tone: t.tone,
        dashed: t.dashed,
        scale: 1,
        segments: buildSegments(points, 1, widthMs),
        pick,
        format: def.format,
      });
    }

    panels.push({
      key: def.key,
      title: def.title,
      subtitle: def.subtitle,
      tracks,
      ceiling: def.fixedCeiling ?? tracksCeiling(tracks),
      formatAxis: def.format,
    });
  }
  return panels;
}
