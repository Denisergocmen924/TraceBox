/**
 * Hesap satırı — `accounts` tablosu (CLAUDE.md §5).
 *
 * Tablo yalnızca İKİ alan taşıyor: kimlik ve açılış anı. E-posta burada değil,
 * Supabase Auth'ta; `accounts.id` ile `auth.users.id` aynı UUID olduğu için
 * ikisini birleştirmeye gerek yok (oturumdaki e-posta zaten kabukta duruyor).
 *
 * RLS: `sel_accounts` politikası yalnızca `id = auth.uid()` satırını gösteriyor,
 * yani sorgu filtre yazmıyor — yazmak güvenlik eklemez, yalnızca politikanın
 * çalıştığı yanılsaması yaratırdı (lib/devices.ts'teki aynı gerekçe).
 *
 * Yazma yolu yok: `accounts` için UPDATE politikası tanımlı değil.
 */
import { supabase } from "./supabase";

export type Account = {
  id: string;
  created_at: string;
};

export async function fetchAccount(): Promise<Account | null> {
  const { data, error } = await supabase()
    .from("accounts")
    .select("id, created_at")
    .maybeSingle();

  if (error) throw error;
  return (data as Account | null) ?? null;
}
