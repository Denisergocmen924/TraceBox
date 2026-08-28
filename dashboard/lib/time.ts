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
