/**
 * Şifre kuralı — kayıt (AuthPanel), kurtarma (AuthPanel) ve Settings'ten
 * değiştirme AYNI kuralı paylaşır. Ayrı kopyalar olsaydı biri geride kalır,
 * kullanıcı bir ekranda kabul edilen şifrenin ötekinde reddedildiğini görürdü.
 *
 * Kural (2026-09-30 kararı): en az 12 karakter + en az bir küçük harf, büyük
 * harf, rakam ve noktalama/özel karakter. Uzunluk, "tracebox şifrem" gibi
 * kısa ve tahmin edilebilir seçimleri engeller.
 *
 * BU DENETİM YALNIZCA KOLAYLIKTIR. Asıl duvar Supabase Auth'un kendi
 * "password strength" ayarıdır (Authentication → Sign In / Providers → Email):
 * tarayıcıdaki kontrol atlanıp doğrudan `/auth/v1/user`'a istek atılabilir,
 * sunucudaki kural atlanamaz. İkisi AYNI kümeyi söylemeli — biri gevşek
 * kalırsa kullanıcı formda geçen bir şifrenin sunucuda reddedildiğini görür.
 * Kural değişirse iki yeri birlikte güncelle.
 */
export const MIN_PASSWORD = 12;

/** Supabase'in "symbols" kümesi (gotrue `AllSymbols`) ile aynı olmalı. */
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

/** Kullanıcıya gösterilen tek satırlık kural özeti. */
export const PASSWORD_RULE_HINT =
  `At least ${MIN_PASSWORD} characters, with a lowercase letter, an uppercase letter, a number and a symbol.`;

/**
 * Şifre kurala uyuyorsa null, uymuyorsa eksik olanların okunur listesi.
 * Yalnızca EKSİKLERİ söyler: kural zaten formun altında yazılı, hata mesajı
 * kullanıcının neyi düzelteceğini göstermeli.
 */
export function passwordProblem(password: string): string | null {
  const missing: string[] = [];
  if (password.length < MIN_PASSWORD) missing.push(`be at least ${MIN_PASSWORD} characters`);
  if (!/[a-z]/.test(password)) missing.push("include a lowercase letter");
  if (!/[A-Z]/.test(password)) missing.push("include an uppercase letter");
  if (!/[0-9]/.test(password)) missing.push("include a number");
  if (![...password].some((c) => SYMBOLS.includes(c))) missing.push("include a symbol");
  return missing.length === 0 ? null : `The password must ${missing.join(", ")}.`;
}
