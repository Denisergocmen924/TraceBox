/**
 * Yakalanan her hatayı ekrana yazılabilir tek bir satıra çevirir.
 *
 * Bu dosya `e instanceof Error ? e.message : String(e)` kalıbının dokuz ayrı
 * yerde tekrarlanmasından doğdu. Kalıp sessizce yanlıştı: Supabase'in
 * `PostgrestError`'ı bir `Error` DEĞİL, `{message, details, hint, code}`
 * şeklinde düz bir nesne (`lib/devices.ts` onu olduğu gibi `throw` ediyor).
 * Yani `String(e)` çalışıyor ve kullanıcı beş sayfada birden
 * "Could not read hosts: [object Object]" görüyordu — hatanın kendisi
 * elimizdeyken.
 *
 * `AuthError` ise gerçekten `Error` türevi; ikisini de aynı fonksiyon karşılar.
 */

/** Düz nesne hatalarının okunabilir alanları — sırayla denenir. */
const MESSAGE_KEYS = ["message", "error_description", "error", "details", "hint"] as const;

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of MESSAGE_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    // Hiçbir metin alanı yoksa nesneyi olduğu gibi göster: "[object Object]"
    // yerine en azından şekli görünsün, hata ayıklanabilir kalsın.
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // döngüsel referans — aşağıdaki yedeğe düş
    }
  }

  return String(error);
}
