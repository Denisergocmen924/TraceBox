/**
 * Ek ölçülerin grafikleri: sıcaklık, swap, yük ortalaması ve GPU.
 *
 * Zaman serisi olan bu dört ölçü grafik olur; zaman serisi olmayan çökme süreç
 * listesi (ayrı bir tablo) burada YOK — o çöküş işaretlerinde gösteriliyor.
 *
 * Bir panel YALNIZCA seçili pencerede o ölçüden en az bir değer varsa çıkar.
 * Makinede karşılığı olmayan ölçü (sensör, GPU yok) null gelir ve paneli açmaz.
 *
 * Çizim donanım grafikleriyle AYNI yoldan geçer: iz (Track) üretilir,
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
        // gösteriyor.
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
 * Pencerede en az bir değeri olan ek ölçülerin grafik panelleri.
 *
 * Hiçbir izi (track) çıkmayan panel döndürülmez.
 */
export function addonPanels(buckets: MetricBucket[], widthMs: number): AddonPanel[] {
  const panels: AddonPanel[] = [];

  for (const def of PANELS) {
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
    if (tracks.length === 0) continue;

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
