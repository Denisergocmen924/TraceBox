/**
 * Bağlanabilir OAuth sağlayıcılarının TEK listesi — giriş ekranı (AuthPanel) ve
 * Settings → Connected accounts aynı diziyi okur. İki ayrı liste olsaydı yeni
 * sağlayıcı bir yerde görünüp ötekinde eksik kalırdı.
 *
 * Yeni sağlayıcı eklemek: buraya bir satır + Supabase'de sağlayıcıyı açmak +
 * sağlayıcının konsolunda Supabase callback adresini yetkilendirmek.
 */
import { IconGitHub, IconGoogle } from "@/components/icons";

export const OAUTH_PROVIDERS = [
  { id: "github", label: "GitHub", Icon: IconGitHub },
  { id: "google", label: "Google", Icon: IconGoogle },
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]["id"];

/** Kimlik adından okunur etiket ("github" → "GitHub"); bilinmeyen olduğu gibi döner. */
export function providerLabel(id: string): string {
  return OAUTH_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
