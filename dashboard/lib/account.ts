/**
 * Hesap satırı — `accounts` tablosu (CLAUDE.md §5).
 *
 * Tablo yalnızca ÜÇ alan taşıyor: saklama süresi, plan ve açılış anı. Kullanıcı
 * kimliği ve e-posta burada değil, Supabase Auth'ta; `accounts.id` ile
 * `auth.users.id` aynı UUID olduğu için ikisini birleştirmeye gerek yok
 * (oturumdaki e-posta zaten kabukta duruyor).
 *
 * RLS: `sel_accounts` politikası yalnızca `id = auth.uid()` satırını gösteriyor,
 * yani sorgu filtre yazmıyor — yazmak güvenlik eklemez, yalnızca politikanın
 * çalıştığı yanılsaması yaratırdı (lib/devices.ts'teki aynı gerekçe).
 *
 * YAZMA YOLU YOK ve olmayacak: `retention_days` bir POLICY, config değil
 * (§2 — "config = insan sınırı, policy = sistem sınırı"). Kullanıcı kendi
 * saklama süresini uzatabilseydi fatura mantrası ("az yaz, seyrek çek, kısa
 * sakla") kullanıcının insafına kalırdı. Settings sayfası bu yüzden değeri
 * gösteriyor ama düzenletmiyor.
 */
import { supabase } from "./supabase";

export type Account = {
  id: string;
  retention_days: number;
  plan: string;
  created_at: string;
};

export async function fetchAccount(): Promise<Account | null> {
  const { data, error } = await supabase()
    .from("accounts")
    .select("id, retention_days, plan, created_at")
    .maybeSingle();

  if (error) throw error;
  return (data as Account | null) ?? null;
}
