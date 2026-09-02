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
import type { CommandType } from "./commands";
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
  /*
   * Ağ, agent tarafında ORAN olarak hesaplanıyor (§4.2): saniyedeki MB, kümüle
   * toplam değil. Kart üstündeki üç çubukta yok — orada yüzde okunuyor ve ağın
   * yüzdesi olmaz (tavanı yok). Yalnızca özet kartlarında görünüyor.
   */
  net_sent_mb: number | null;
  net_recv_mb: number | null;
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
  /*
   * Açılış anı. Listede DE gerekiyor: Overview'ın Host Status tablosunda
   * "Uptime" sütunu var ve o sütun bu alandan türüyor. Yalnızca detayda
   * tutulsaydı tablo cihaz başına ikinci bir sorgu açmak zorunda kalırdı.
   */
  last_boot: string | null;
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
  if (isSilent(device, now)) return "offline";
  if (!device.logging_enabled) return "paused";
  return "online";
}

/**
 * "Makine konuşmuyor mu?" — `deviceStatus`'tan AYRI durması gerekiyor.
 *
 * Durum tek bir etiket üretir ve `deleting` her şeyin üstündedir (yukarıdaki
 * sıra). Ama sessizlik o etiketle birlikte kaybolmaz: silme emri verilmiş bir
 * cihaz da sessiz OLABİLİR — hatta en sık o olur, çünkü ulaşılamayan makineye
 * emir gönderip beklemek tam olarak kullanıcının sıkıştığı yerdir.
 *
 * Sessizliği yalnızca `status === "offline"` üzerinden okuyan arayüz, delete
 * kuyruğa girdiği anda cihazı konuşuyor sayardı: force remove butonu kaybolur
 * (tam ona ihtiyaç duyulan anda) ve "agent ~10 sn içinde uygular" yazısı hiç
 * görülmemiş bir makine için çıkardı.
 */
export function isSilent(device: Device, now: number): boolean {
  return (
    device.last_seen == null ||
    now - Date.parse(device.last_seen) > OFFLINE_AFTER_SECONDS * 1000
  );
}

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: "Online",
  offline: "Offline",
  paused: "Paused",
  deleting: "Deleting",
};

/**
 * Kart için gereken en küçük sütun kümesi + gömülü son metrik.
 * Detay ekranı (§9.4) bunun üstüne envanterin kalanını ekler.
 */
const LIST_COLUMNS = `id, device_name, os_name, os_version, arch, cpu_cores_logical,
   ram_total_mb, disk_total_mb, agent_version, last_boot, logging_enabled, last_seen,
   metrics ( measured_at, cpu_percent, ram_used_mb, disk_percent,
             net_sent_mb, net_recv_mb )`;

const DETAIL_COLUMNS = `${LIST_COLUMNS}, cpu_model, cpu_cores_physical,
   kernel_version, gpu_model, external_ip, enabled_addons`;

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
  /**
   * Bu cihaz için BEKLEYEN komut türleri. Listede yok, çünkü kart yalnızca
   * silinmeyi gösteriyor; detayda gerekiyor: aynı komutu ikinci kez sıraya
   * koymayı engelleyen ve "gönderildi, uygulanmayı bekliyor" ara durumunu
   * yazan tek kaynak bu (§6 — ayrı bir bayrak sütunu yok, hâl kuyruktan okunur).
   */
  pendingCommands: CommandType[];
  cpu_model: string | null;
  cpu_cores_physical: number | null;
  kernel_version: string | null;
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

  // Listeden farklı olarak TÜM bekleyen komutlar çekiliyor, yalnızca delete
  // değil: sağ paneldeki duraklat/devam düğmesi de kendi emrinin sırada olup
  // olmadığını bilmek zorunda.
  const commandQuery = client
    .from("commands")
    .select("type")
    .eq("device_id", id)
    .eq("status", "pending");

  const [device, commands] = await Promise.all([deviceQuery, commandQuery]);

  if (device.error) {
    if (device.error.code === INVALID_TEXT_REPRESENTATION) return null;
    throw device.error;
  }
  if (!device.data) return null;
  if (commands.error) throw commands.error;

  const { metrics, ...rest } = device.data as unknown as DeviceRow &
    Omit<DeviceDetail, keyof Device>;

  const pending = (commands.data ?? []).map((c) => c.type as CommandType);

  return {
    ...rest,
    latest: metrics[0] ?? null,
    pendingCommands: pending,
    deletePending: pending.includes("delete"),
  };
}

/**
 * ZORLA KALDIRMA — `devices` satırını doğrudan siler (§6, §9.13).
 *
 * Normal silme yolu bu DEĞİLDİR. Orada dashboard yalnızca bir `delete` komutu
 * kuyruğa koyar; agent onu alır, makineyi temizler, ack'ler ve satırı
 * COLLECTOR siler (§11 Boşluk E). Sıralama böyle olmak zorunda: satır erken
 * silinseydi agent bir sonraki poll'da 401 alır ve silme emrini hiç göremezdi.
 *
 * Bu fonksiyon o sıralamayı bilerek atlıyor, çünkü tam olarak agent'ın bir
 * daha hiç bağlanmayacağı durum için var: disk ölmüş, VM yok edilmiş, makine
 * emekliye ayrılmış. O cihaz için kuyrukta sonsuza kadar bekleyen bir emir ve
 * listede duran ölü bir kart kalmasın diye kayıt elle düşürülüyor.
 *
 * BEDELİ ŞU: makine bir gün geri dönerse agent hâlâ kurulu olur ve anahtarı
 * artık hiçbir satırla eşleşmez — her gönderimde 401 alıp yerelde spool eder.
 * O yüzden çağıran taraf bunu yalnızca çevrimdışı cihazlarda öneriyor ve
 * kullanıcıya `uninstall.sh`'ten söz ediyor.
 *
 * Yetki tarafı: RLS `del_devices` politikası (`account_id = auth.uid()`) izin
 * veriyor, FK'ler `ON DELETE CASCADE` olduğu için metrik/log/çöküş/komut
 * satırları da veritabanı tarafından siliniyor — burada tek bir DELETE var.
 */
export async function forceRemoveDevice(id: string): Promise<void> {
  const { error } = await supabase().from("devices").delete().eq("id", id);
  if (error) throw error;
}

/* --- Envanter (Inventory sayfası) ---------------------------------------- */

/**
 * Cihazın DEĞİŞMEYEN künyesi — kabuğun 10 saniyede bir çektiği listede yok.
 *
 * `LIST_COLUMNS` bilerek dar: o sorgu her 10 saniyede bir koşuyor ve cpu_model,
 * kernel_version, gpu_model gibi ayda bir değişen alanları her turda indirmek
 * saf israf olurdu. Envanter sayfası ise TAM olarak o alanlar için var, o
 * yüzden kendi sorgusunu bir kez açıyor.
 */
export type InventoryDevice = Device & {
  cpu_model: string | null;
  cpu_cores_physical: number | null;
  kernel_version: string | null;
  gpu_model: string | null;
  external_ip: string | null;
  enabled_addons: string[];
};

/**
 * Hesabın tüm cihazlarının envanteri, tek sorguda.
 *
 * Cihaz başına `fetchDevice` çağırmak N+1 olurdu; burada aynı DETAIL_COLUMNS
 * kümesi tek seferde, `id` filtresi olmadan çekiliyor — RLS zaten hesabın
 * dışına çıkmayı engelliyor.
 */
export async function fetchInventory(): Promise<InventoryDevice[]> {
  const client = supabase();

  const devicesQuery = client
    .from("devices")
    .select(DETAIL_COLUMNS)
    .order("measured_at", { referencedTable: "metrics", ascending: false })
    .limit(1, { referencedTable: "metrics" })
    .order("device_name");

  // Durum rozeti için: silme bekleyen cihaz "Deleting" görünmeli (§9.3'ün
  // dört hâli). Rozeti atlayıp yalnızca künyeyi göstermek, envanterde artık
  // var olmayacak bir makineyi hâlâ envanterdeymiş gibi listelemek olurdu.
  const commandsQuery = client
    .from("commands")
    .select("device_id")
    .eq("type", "delete")
    .eq("status", "pending");

  const [devices, commands] = await Promise.all([devicesQuery, commandsQuery]);

  if (devices.error) throw devices.error;
  if (commands.error) throw commands.error;

  const pending = new Set((commands.data ?? []).map((c) => c.device_id));

  return (devices.data as unknown as (DeviceRow &
    Omit<InventoryDevice, keyof Device>)[]).map(({ metrics, ...device }) => ({
    ...device,
    latest: metrics[0] ?? null,
    deletePending: pending.has(device.id),
  }));
}
