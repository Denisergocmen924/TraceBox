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
  /**
   * Satırın hangi makineden geldiği. Cihaz detayında gereksiz (zaten tek bir
   * makineye bakılıyor) ama hesap genelindeki Logs sayfasında satırın en
   * önemli sütunu: kaynağı yazmayan bir akış, birbirine karışmış iki makinenin
   * loglarını tek bir makinenin logu gibi gösterirdi.
   */
  device_id: string;
  measured_at: string;
  level: LogLevel;
  message: string;
  source: string | null;
};

/* --- Kullanıcıya gösterilen aralıklar (§9.5) ------------------------------ */

export type RangeKey = "1h" | "24h" | "2d" | "5d" | "7d" | "10d";

/**
 * §9.5'in listesine "son 1 saat" EKLENDİ. Sebep referans 2: üst çubuktaki
 * seçici görselde "Last 1 hour" yazıyor ve System Metrics grafiği bir saatlik
 * bir pencere çiziyor. Ekleme §9.5 ile çelişmiyor — o madde en UZUN pencereyi
 * (10 gün, retention ile aynı) ve blok mantığını kilitliyor; daha kısa bir
 * pencere blok aritmetiğini değiştirmiyor, yalnızca tek bloğun içinden daha
 * dar bir dilim kesiyor.
 */
export const RANGES: { key: RangeKey; label: string; seconds: number }[] = [
  { key: "1h", label: "1 hour", seconds: 3600 },
  { key: "24h", label: "24 hours", seconds: 24 * 3600 },
  { key: "2d", label: "2 days", seconds: 2 * 86400 },
  { key: "5d", label: "5 days", seconds: 5 * 86400 },
  { key: "7d", label: "1 week", seconds: 7 * 86400 },
  { key: "10d", label: "10 days", seconds: 10 * 86400 },
];

/* --- Seviye süzgeci ------------------------------------------------------- */

/**
 * Süzgeç TAM EŞLEŞMEDİR: "warning" seçildiğinde yalnızca warning satırları
 * kalır.
 *
 * Önceki hâli bir EŞİKTİ — "warning" error ve critical'ı da içeriyordu, düğme
 * de bunu `warning+` diye duyuruyordu. Gerekçesi savunulabilirdi (kullanıcı
 * sorun ararken en ciddi satırı gizlememek), ama kullanıcı testinde tam da
 * korkulan yanlış anlama çıktı: "warning ve error beraber warning adı altında
 * listeleniyor". Etiketteki artı işareti okunmadı; okunsaydı bile bir seviyeyi
 * tek başına görmenin yolu yoktu. `logs.level` dört ayrı değer taşıyorsa
 * süzgeç de dört ayrı seçenek sunmalı.
 *
 * Bedeli açık: "tüm sorunlar" diye tek bir görünüm artık yok — warning ve
 * error'a aynı anda bakmak için `all` gerekiyor. Bu bilinçli bir takas;
 * karşılığında hiçbir düğme sessizce başka bir seviyeyi içeri almıyor.
 */
export type LevelFilter = "all" | LogLevel;

export const FILTER_LEVELS: Record<LevelFilter, LogLevel[]> = {
  all: ["info", "warning", "error", "critical"],
  info: ["info"],
  warning: ["warning"],
  error: ["error"],
  critical: ["critical"],
};

export const LEVEL_FILTER_LABEL: Record<LevelFilter, string> = {
  all: "all",
  info: "info",
  warning: "warning",
  error: "error",
  critical: "critical",
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
 * Pencereyi kapsayan blok anahtarları, YENİDEN ESKİYE.
 *
 * "Son 24 saat" ile "bugünün bloğu" aynı şey değildir: saat 09:00'da bugünün
 * bloğu 9 saatliktir, dolayısıyla dünün bloğu da gerekir. Aynı sebeple
 * "son 2 gün" 3 blok indirir ve UÇ bloklarının kenarı kırpılır (§9.5).
 *
 * İki ucu da parametre almasının sebebi yakınlaştırma (§9.8): grafikte seçilen
 * pencerenin sağ ucu artık "şu an" olmak zorunda değil. Tek bir süre alsaydı
 * dünün 14:00–14:05 aralığına yakınlaşan kullanıcıya o andan bugüne kadarki
 * tüm loglar inerdi.
 */
export function blocksForWindow(fromMs: number, toMs: number): string[] {
  const keys: string[] = [];
  let day = blockStart(blockKey(toMs));
  while (day + DAY_MS > fromMs) {
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
  /**
   * `null` = hesabın TÜM cihazları (Logs sayfası). Filtre yazılmadığında
   * RLS'in kendi `account_id = auth.uid()` kuralı devrede kalıyor, yani
   * kapsam yine hesapla sınırlı — sorgu güvenliği kaybetmiyor, yalnızca
   * daraltmayı bırakıyor.
   */
  deviceId: string | null;
  block: string;
  level: LevelFilter;
  offset: number;
  windowFromMs: number;
  windowToMs: number;
  /**
   * Bir sayfada kaç satır. Yalnızca ATILMIŞ bir bloğu geri getirirken
   * veriliyor (§9.5): blok bellekten düşerken kaç satırı olduğu biliniyor,
   * dolayısıyla geri dönüşte aynı sayı tek istekte çekilebiliyor. Sayfa sayfa
   * yeniden yüklenseydi bloğun yüksekliği adım adım büyür ve kullanıcının
   * altında duran içerik her adımda kayardı.
   */
  limit?: number;
}): Promise<{ rows: LogRow[]; blockDone: boolean }> {
  const { deviceId, block, level, offset, windowFromMs, windowToMs } = params;
  const size = params.limit ?? LOG_PAGE_SIZE;

  // Bloğun kendi sınırları ile pencerenin sınırlarının KESİŞİMİ. Uç blokların
  // kenarını kırpan yer burası: "son 2 gün"de en eski bloğun başı, grafikte
  // yakınlaşıldığında ise iki uç birden kırpılıyor.
  const from = Math.max(blockStart(block), windowFromMs);
  const to = Math.min(blockStart(block) + DAY_MS, windowToMs);

  let query = supabase()
    .from("logs")
    .select("id, device_id, measured_at, level, message, source");

  if (deviceId) query = query.eq("device_id", deviceId);

  const { data, error } = await query
    .in("level", FILTER_LEVELS[level])
    .gte("measured_at", new Date(from).toISOString())
    .lt("measured_at", new Date(to).toISOString())
    .order("measured_at", { ascending: false })
    .range(offset, offset + size - 1);

  if (error) throw error;

  const rows = (data ?? []) as LogRow[];
  return { rows, blockDone: rows.length < size };
}
