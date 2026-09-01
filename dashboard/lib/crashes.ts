/**
 * Çöküş anları (`crash_snapshots`) — §9.4.
 *
 * Bu tablo TraceBox'ın iddiasının kanıtı. Agent bir eşiği aştığında (cpu>90,
 * ram>90, disk>95 ya da error/critical bir log — §7 `flush.py`) o anın en çok
 * kaynak yiyen süreçlerini bir kez fotoğraflıyor ve ACİL gönderiyor. Yani
 * makine erişilemez hâle geldiğinde elde kalan şey, çöküşten hemen önceki
 * kareler.
 *
 * Zaman ölçütü `measured_at`: kullanıcı GRAFİKTE bir ana bakıyor ve grafik de
 * `measured_at` üzerinden çiziliyor. `received_at` retention'ın ölçütü (§5) —
 * gecikmiş bir gönderimde ikisi saatlerce ayrışabilir, o zaman işaret grafikte
 * yanlış yere düşerdi.
 */
import { supabase } from "./supabase";

/**
 * Tek bir sürecin fotoğrafı. Alan adları agent'ın gönderdiği JSON'la aynı
 * (§4.2): `[{name, cpu, ram_mb}, …]`.
 */
export type CrashProcess = {
  name: string;
  cpu: number | null;
  ram_mb: number | null;
};

export type CrashSnapshot = {
  id: string;
  measured_at: string;
  /** cpu | ram | disk | log — agent'ı tetikleyen eşik (§4.2). */
  trigger_reason: string | null;
  processes: CrashProcess[];
};

/**
 * Bir aralıkta en çok kaç çöküş kaydı çekilir.
 *
 * Flush cooldown'ı 20 saniye (§7), yani teoride dakikada üç kayıt. Günlerce
 * takılı kalmış bir makinede bu binlerce satır eder; hepsini indirmek hem
 * anlamsız (grafik ~1000 piksel, işaretler zaten üst üste biner) hem de
 * pahalı — `processes` alanı JSON ve satır başına kilobaytlarca olabilir.
 *
 * Sınır aşılırsa çağıran taraf bunu kullanıcıya SÖYLÜYOR; sessizce kırpmak,
 * §9.6 madde 5'in seyreltme için koyduğu dürüstlük kuralını çöküş işaretleri
 * için çiğnemek olurdu.
 */
export const CRASH_LIMIT = 200;

export async function fetchCrashSnapshots(params: {
  deviceId: string;
  fromMs: number;
  toMs: number;
}): Promise<{ rows: CrashSnapshot[]; truncated: boolean }> {
  const { deviceId, fromMs, toMs } = params;

  const { data, error } = await supabase()
    .from("crash_snapshots")
    .select("id, measured_at, trigger_reason, processes")
    .eq("device_id", deviceId)
    .gte("measured_at", new Date(fromMs).toISOString())
    .lte("measured_at", new Date(toMs).toISOString())
    // En yeniden geriye: sınıra takılırsa kaybedilenler en ESKİ kayıtlar olur.
    // Ters sırada olsaydı, kullanıcı "az önce ne oldu" diye baktığında tam da
    // aradığı kayıtlar kırpılırdı.
    .order("measured_at", { ascending: false })
    .limit(CRASH_LIMIT);

  if (error) throw error;

  const rows = (data ?? []) as CrashSnapshot[];
  return { rows, truncated: rows.length === CRASH_LIMIT };
}

/**
 * İşaretin rengi ve etiketi — tetikleyen eşiğe göre.
 *
 * Renkler grafiğin ölçü renkleriyle AYNI (§9.11.2: CPU mor, RAM yeşil, disk
 * turuncu): CPU yüzünden tetiklenmiş bir işaret, altındaki mor eğrinin
 * rengini taşıyor. Böylece hangi ölçünün patladığı, işaret okunmadan önce
 * anlaşılıyor. `log` tetikleyicisinin grafikte bir eğrisi yok; o kırmızı —
 * log listesindeki `error` rozetiyle aynı renk.
 *
 * Sınıf adları TAM METİN yazılmak zorunda: Tailwind kaynak dosyayı düz metin
 * olarak tarıyor, `text-${key}` gibi bir şey üretilirse o sınıf CSS'e hiç
 * girmez.
 */
export const TRIGGER: Record<
  string,
  { label: string; text: string; chip: string }
> = {
  cpu: { label: "CPU", text: "text-cpu", chip: "bg-cpu-soft text-cpu" },
  ram: { label: "Memory", text: "text-ram", chip: "bg-ram-soft text-ram" },
  disk: { label: "Disk", text: "text-disk", chip: "bg-disk-soft text-disk" },
  log: {
    label: "Log",
    text: "text-danger",
    chip: "bg-danger-soft text-danger",
  },
};

/** Bilinmeyen bir `trigger_reason` da çizilebilmeli — kayıt yine gerçek. */
export const TRIGGER_FALLBACK = {
  label: "Event",
  text: "text-muted",
  chip: "bg-panel-2 text-muted",
};

export function triggerStyle(reason: string | null) {
  return (reason && TRIGGER[reason]) || TRIGGER_FALLBACK;
}
