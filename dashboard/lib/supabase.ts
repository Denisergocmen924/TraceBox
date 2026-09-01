/**
 * Tarayıcının Supabase'e açılan tek kapısı.
 *
 * Neden fonksiyon, neden hazır bir nesne değil: bu sayfaların hepsi
 * "use client" ama Next yine de derleme sırasında sunucuda bir kez çalıştırıp
 * HTML iskeletini üretir. İstemci modül yüklenirken kurulsaydı, ortam
 * değişkenleri olmayan her derleme kırılırdı. Fonksiyon, kurulumu ilk gerçek
 * kullanıma erteler — yani tarayıcıya.
 *
 * İstemci **bir kez** kurulur ve saklanır. İkinci bir örnek kurulsaydı iki ayrı
 * oturum yöneticisi aynı localStorage anahtarını yazar, token yenilemede
 * birbirini ezerlerdi.
 *
 * Burada service key YOK: collector service key ile YAZAR (RLS bypass),
 * dashboard anon key ile OKUR (RLS zorunlu) — CLAUDE.md §11 Boşluk D.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function required(name: string, value: string | undefined): string {
  if (!value) {
    // Sessizce undefined ile devam etmek en kötüsü: istemci kurulur, her
    // sorgu anlamsız bir ağ hatasıyla döner ve sebebi görünmez olur.
    throw new Error(
      `Missing environment variable: ${name}. See dashboard/.env.example.`,
    );
  }
  return value;
}

export function supabase(): SupabaseClient {
  if (cached) return cached;

  // NEXT_PUBLIC_* değişkenleri derleme anında koda gömülür; bu yüzden
  // process.env erişimi tam adıyla yazılmalı (değişken adıyla okunamaz).
  cached = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    {
      auth: {
        // Oturum tarayıcıda saklanır ve süresi dolmadan kendini yeniler.
        // SSR yok (§9.1), o yüzden sunucu tarafında çerez okumaya gerek yok.
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
  return cached;
}
