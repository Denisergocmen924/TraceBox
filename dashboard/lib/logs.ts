/**
 * Log listesinin veri katmanı (CLAUDE.md §9.4 + §9.5).
 *
 * Buradaki tek büyük fikir: veri BLOK BLOK çekilir. Blok = bir takvim günü,
 * sınırı 00:00 UTC. Kapanmış bir günün verisi bir daha asla değişmez, yani
 * süresiz önbelleklenebilir — "son 3 gün" gibi kayan bir pencerede sınır her
 * saniye kaydığı için hiçbir şey önbelleklenemezdi.
 *
 * Saat dilimi UTC, çünkü retention (db/retention.sql) da UTC'ye göre siliyor.
 * İki ayrı "gün" tanımı olsaydı, kapandı sanılan bir bloğun içi retention
 * gece yarısı çalıştığında değişebilirdi.
 *
 * Blok kullanıcıya HİÇ gösterilmez (§9.5). Arayüzde yalnızca "son X" aralıkları
 * ve satır bazında yerel saat var; blok tamamen içeride, çekme birimi olarak yaşar.
 */
import { supabase } from "./supabase";

export type LogLevel = "info" | "warning" | "error" | "critical";

export type LogRow = {
  id: string;
  measured_at: string;
  level: LogLevel;
  message: string;
  source: string | null;
};

/* --- Kullanıcıya gösterilen aralıklar (§9.5) ------------------------------ */

export type RangeKey = "24h" | "2d" | "5d" | "7d" | "10d";

export const RANGES: { key: RangeKey; label: string; seconds: number }[] = [
  { key: "24h", label: "24 saat", seconds: 24 * 3600 },
  { key: "2d", label: "2 gün", seconds: 2 * 86400 },
  { key: "5d", label: "5 gün", seconds: 5 * 86400 },
  { key: "7d", label: "1 hafta", seconds: 7 * 86400 },
  { key: "10d", label: "10 gün", seconds: 10 * 86400 },
];

/* --- Seviye süzgeci ------------------------------------------------------- */

/**
 * Süzgeç bir EŞİKTİR, tam eşleşme değil: "warning" seçildiğinde error ve
 * critical de listede kalır. Aksi hâlde "warning" filtresi bir error'ı
 * gizlerdi — kullanıcı sorunları arıyorken en ciddi satırı saklamak,
 * süzgecin var oluş amacına ters.
 */
export type LevelFilter = "all" | "warning" | "error";

export const LEVELS_AT_OR_ABOVE: Record<LevelFilter, LogLevel[]> = {
  all: ["info", "warning", "error", "critical"],
  warning: ["warning", "error", "critical"],
  error: ["error", "critical"],
};

export const LEVEL_FILTER_LABEL: Record<LevelFilter, string> = {
  all: "hepsi",
  warning: "warning+",
  error: "error+",
};

/* --- Blok aritmetiği ------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** Bir ana karşılık gelen UTC gün anahtarı: "2026-08-28". */
export function blockKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function blockStart(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

/**
 * Aralığı kapsayan blok anahtarları, YENİDEN ESKİYE.
 *
 * "Son 24 saat" ile "bugünün bloğu" aynı şey değildir: saat 09:00'da bugünün
 * bloğu 9 saatliktir, dolayısıyla dünün bloğu da gerekir. Aynı sebeple
 * "son 2 gün" 3 blok indirir ve en eski bloğun kenarı kırpılır (§9.5).
 */
export function blocksForRange(now: number, seconds: number): string[] {
  const start = now - seconds * 1000;
  const keys: string[] = [];
  let day = blockStart(blockKey(now));
  while (day + DAY_MS > start) {
    keys.push(blockKey(day));
    day -= DAY_MS;
  }
  return keys;
}

/* --- Çekme ---------------------------------------------------------------- */

/**
 * Blok CACHE birimi, çekme birimi DEĞİL. Yoğun bir gün on binlerce satır
 * tutabilir; bloğun tamamını tek istekte indirmek tarayıcıyı kilitlerdi.
 * Bu yüzden blok içinde de sayfa sayfa ilerlenir.
 */
export const LOG_PAGE_SIZE = 200;

export async function fetchLogPage(params: {
  deviceId: string;
  block: string;
  level: LevelFilter;
  offset: number;
  rangeStartMs: number;
}): Promise<{ rows: LogRow[]; blockDone: boolean }> {
  const { deviceId, block, level, offset, rangeStartMs } = params;

  // Alt sınır: bloğun başı ile aralığın başından HANGİSİ SONRAYSA o. En eski
  // bloğun kenarını kırpan yer burası.
  const from = Math.max(blockStart(block), rangeStartMs);
  const to = blockStart(block) + DAY_MS;

  const { data, error } = await supabase()
    .from("logs")
    .select("id, measured_at, level, message, source")
    .eq("device_id", deviceId)
    .in("level", LEVELS_AT_OR_ABOVE[level])
    .gte("measured_at", new Date(from).toISOString())
    .lt("measured_at", new Date(to).toISOString())
    .order("measured_at", { ascending: false })
    .range(offset, offset + LOG_PAGE_SIZE - 1);

  if (error) throw error;

  const rows = (data ?? []) as LogRow[];
  return { rows, blockDone: rows.length < LOG_PAGE_SIZE };
}
