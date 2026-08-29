/**
 * Cihaz listesinin veri katmanı (CLAUDE.md §9.3).
 *
 * Kartın gösterdiği bilgi üç ayrı yerden gelir:
 *   künye ............ devices satırı
 *   üç ölçü .......... o cihazın EN SON metrics satırı
 *   "silinme bekliyor" commands tablosu (type='delete', status='pending')
 *
 * Hepsi RLS altında: sorgular account_id filtresi YAZMAZ, çünkü politika
 * (`account_id = auth.uid()`) zaten satır bazında süzüyor. Elle filtre yazmak
 * güvenlik eklemez, sadece politikanın çalıştığı yanılsaması yaratır.
 */
import { supabase } from "./supabase";

/**
 * Çevrimdışı eşiği — §9.3'te kilitli. Agent 10 saniyede bir komut soruyor ve
 * her soruş last_seen'i tazeliyor; 60 saniye "üst üste 6 tur kaçırıldı" demek.
 * Tesadüf olamayacak kadar uzun, fark etmeyi geciktirmeyecek kadar kısa.
 */
export const OFFLINE_AFTER_SECONDS = 60;

export type LatestMetric = {
  measured_at: string;
  cpu_percent: number | null;
  ram_used_mb: number | null;
  disk_percent: number | null;
};

export type DeviceRow = {
  id: string;
  device_name: string;
  os_name: string | null;
  os_version: string | null;
  arch: string | null;
  cpu_cores_logical: number | null;
  ram_total_mb: number | null;
  disk_total_mb: number | null;
  agent_version: string | null;
  logging_enabled: boolean;
  last_seen: string | null;
  metrics: LatestMetric[]; // gömülü sorgu her zaman dizi döner: 0 ya da 1 satır
};

export type Device = Omit<DeviceRow, "metrics"> & {
  latest: LatestMetric | null;
  deletePending: boolean;
};

export type DeviceStatus = "online" | "offline" | "paused" | "deleting";

/**
 * Dört hâlin SIRASI önemli — bir cihaz aynı anda birkaçına uyabilir.
 *
 * 1. deleting — silme emri verilmiş; her şeyin üstünde, çünkü cihazın geleceği
 *    hakkında söylenecek en önemli şey bu.
 * 2. offline  — makine konuşmuyor. Duraklatmanın önünde geliyor, çünkü pause
 *    sırasında agent komut poll'una DEVAM eder (§7) ve last_seen tazelenir.
 *    Yani "hem duraklatılmış hem sessiz" bir cihazda asıl haber sessizliktir.
 * 3. paused   — kullanıcının kendi kararı, makine sağlıklı.
 * 4. online   — geriye kalan.
 */
export function deviceStatus(device: Device, now: number): DeviceStatus {
  if (device.deletePending) return "deleting";

  const stale =
    device.last_seen == null ||
    now - Date.parse(device.last_seen) > OFFLINE_AFTER_SECONDS * 1000;
  if (stale) return "offline";

  if (!device.logging_enabled) return "paused";
  return "online";
}

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: "Çevrimiçi",
  offline: "Çevrimdışı",
  paused: "Duraklatıldı",
  deleting: "Silinme bekliyor",
};

/**
 * Kart için gereken en küçük sütun kümesi + gömülü son metrik.
 * Detay ekranı (§9.4) bunun üstüne envanterin kalanını ekler.
 */
const LIST_COLUMNS = `id, device_name, os_name, os_version, arch, cpu_cores_logical,
   ram_total_mb, disk_total_mb, agent_version, logging_enabled, last_seen,
   metrics ( measured_at, cpu_percent, ram_used_mb, disk_percent )`;

const DETAIL_COLUMNS = `${LIST_COLUMNS}, cpu_model, cpu_cores_physical,
   kernel_version, last_boot, gpu_model, external_ip, enabled_addons`;

export async function fetchDevices(): Promise<Device[]> {
  const client = supabase();

  // Tek sorguda cihaz + o cihazın son metriği. PostgREST gömülü kaynağa
  // ayrı order/limit uygulayabiliyor; limit HER ana satır için ayrı işler,
  // yani "cihaz başına 1 metrik" demek. (device_id, measured_at) indeksi
  // zaten var, sorgu o indeksin üstünden yürür.
  const devicesQuery = client
    .from("devices")
    .select(LIST_COLUMNS)
    .order("measured_at", { referencedTable: "metrics", ascending: false })
    .limit(1, { referencedTable: "metrics" })
    .order("device_name");

  // Bekleyen silme emirleri ayrı sorgu. Gömülü de çekilebilirdi ama gömülü
  // kaynağa filtre uygulamak sorguyu okunmaz hale getiriyor; satır sayısı
  // (hesap başına bekleyen komut) her zaman avuç içi kadar.
  const commandsQuery = client
    .from("commands")
    .select("device_id")
    .eq("type", "delete")
    .eq("status", "pending");

  const [devices, commands] = await Promise.all([devicesQuery, commandsQuery]);

  if (devices.error) throw devices.error;
  if (commands.error) throw commands.error;

  const pending = new Set((commands.data ?? []).map((c) => c.device_id));

  return (devices.data as unknown as DeviceRow[]).map(
    ({ metrics, ...device }) => ({
      ...device,
      latest: metrics[0] ?? null,
      deletePending: pending.has(device.id),
    }),
  );
}

/* --- Cihaz detayı (§9.4) -------------------------------------------------- */

/** Sağ paneldeki künye — listede gereksiz olan envanter alanları. */
export type DeviceDetail = Device & {
  cpu_model: string | null;
  cpu_cores_physical: number | null;
  kernel_version: string | null;
  last_boot: string | null;
  gpu_model: string | null;
  external_ip: string | null;
  enabled_addons: string[];
};

/** Postgres: geçersiz UUID metni. Uydurulmuş bir URL hataya değil, 404'e düşmeli. */
const INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * Tek cihaz + son metriği + bekleyen silme emri.
 *
 * `null` dönmesi "yok" demek DEĞİL, "sana görünmüyor" demek: RLS başkasının
 * cihazını da tam olarak böyle gizler. Ekranda ikisini ayırmaya çalışmıyoruz,
 * çünkü ayırmak zaten bir bilgi sızıntısı olurdu.
 */
export async function fetchDevice(id: string): Promise<DeviceDetail | null> {
  const client = supabase();

  const deviceQuery = client
    .from("devices")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .order("measured_at", { referencedTable: "metrics", ascending: false })
    .limit(1, { referencedTable: "metrics" })
    .maybeSingle();

  const commandQuery = client
    .from("commands")
    .select("id")
    .eq("device_id", id)
    .eq("type", "delete")
    .eq("status", "pending")
    .limit(1);

  const [device, commands] = await Promise.all([deviceQuery, commandQuery]);

  if (device.error) {
    if (device.error.code === INVALID_TEXT_REPRESENTATION) return null;
    throw device.error;
  }
  if (!device.data) return null;
  if (commands.error) throw commands.error;

  const { metrics, ...rest } = device.data as unknown as DeviceRow &
    Omit<DeviceDetail, keyof Device>;

  return {
    ...rest,
    latest: metrics[0] ?? null,
    deletePending: (commands.data ?? []).length > 0,
  };
}
