/**
 * "12 saniye önce" — kartın alt satırındaki insan okunur zaman.
 *
 * `now` dışarıdan verilir, içeride Date.now() çağrılmaz. Sebep iki tane:
 * bileşen saniyede bir tik atıp aynı fonksiyonu yeniden çağırdığında tüm
 * kartlar AYNI ana göre hesaplanır (biri 11, diğeri 12 saniye demez), ve
 * fonksiyon test edilebilir kalır.
 */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "hiç görülmedi";

  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds} saniye önce`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dakika önce`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;

  return `${Math.floor(hours / 24)} gün önce`;
}

/** 16384 → "16.0 GB". Kartta MB yazmak okunaksız. */
export function gb(mb: number | null | undefined): string {
  if (mb == null) return "—";
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Log satırının zaman damgası — YEREL saatle (§9.5).
 *
 * Bloklar UTC'ye göre bölünüyor ama kullanıcı UTC'de yaşamıyor. Blok sınırı
 * içeride bir önbellek detayı; ekranda görünen her saat kullanıcının kendi
 * saatidir. Aynı gün içindeyse yalnızca saat, değilse gün de eklenir —
 * "14:32:07" iki gün önceye aitken tek başına yanıltıcı olurdu.
 */
export function logTime(iso: string, now: number): string {
  const d = new Date(iso);
  const clock = d.toLocaleTimeString("tr-TR", { hour12: false });
  const sameDay = d.toDateString() === new Date(now).toDateString();
  if (sameDay) return clock;
  return `${d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} ${clock}`;
}

/** "2026-08-28T09:00:00Z" → "28.08.2026 12:00" (yerel). Künyedeki açılış anı. */
export function localDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Grafiğin x ekseni etiketi — YEREL saat, aralığın uzunluğuna göre kısalır.
 *
 * Saniye YOK: eksende beş etiket var ve aralarındaki mesafe dakikalarla
 * ölçülüyor; saniye yazmak okunacak bir bilgi değil, göze giren gürültü olurdu.
 * 36 saatten uzun aralıklarda gün de eklenir — yoksa "03:00" iki farklı güne
 * ait iki etikette aynı görünürdü.
 */
export function axisTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const clock = d.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (spanMs <= 36 * 3600 * 1000) return clock;
  const day = d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
  return `${day} ${clock}`;
}
