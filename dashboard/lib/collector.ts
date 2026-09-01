/**
 * Collector'a yapılan TEK istemci çağrısı: POST /devices.
 *
 * Dashboard'un okuma yolu Supabase'e doğrudan bağlanıyor (§9.1); collector'a
 * yalnızca cihaz kaydı gidiyor, çünkü cihaz anahtarını üreten ve yalnızca
 * özetini saklayan yer orası (§11 Boşluk B). Anahtarı tarayıcıda üretmek,
 * "düz hali hiçbir yerde durmaz" kuralını daha ilk adımda bozardı.
 *
 * Kimlik, kullanıcının Supabase access token'ı. Collector onu Supabase'in JWKS
 * ucundan çektiği açık anahtarla doğruluyor (§6) — yani burada paylaşılan bir
 * sır taşınmıyor, yalnızca kullanıcının kendi oturumu.
 */
import { supabase } from "./supabase";

/** Collector'ın adresi; okuma istekleri buraya GİTMEZ. */
function collectorUrl(): string {
  // NEXT_PUBLIC_* derleme anında gömülür, o yüzden tam adıyla yazılmalı.
  const raw = process.env.NEXT_PUBLIC_COLLECTOR_URL;
  if (!raw) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_COLLECTOR_URL. See dashboard/.env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

export type CreatedDevice = {
  device_id: string;
  device_name: string;
  /**
   * Düz anahtar — YALNIZCA bu yanıtta var.
   *
   * Veritabanında yalnızca SHA-256 özeti duruyor, yani pencere kapandıktan
   * sonra bu değeri hiç kimse geri getiremez. §9.10 bu yüzden pencerenin
   * onaysız kapanmasını yasaklıyor.
   */
  device_key: string;
};

/**
 * Yeni cihaz açar ve anahtarını döndürür.
 *
 * Hata mesajları kullanıcının GÖRECEĞİ metinler; collector'ın `detail` alanı
 * varsa o tercih ediliyor — sunucu sorunun ne olduğunu istemciden daha iyi
 * biliyor (örneğin "aynı ada sahip bir host zaten var").
 */
export async function createDevice(deviceName: string): Promise<CreatedDevice> {
  const {
    data: { session },
  } = await supabase().auth.getSession();

  if (!session) {
    // Kabuk zaten oturumsuz kullanıcıyı /login'e atıyor; buraya ancak token
    // tam da bu sırada düşerse gelinir.
    throw new Error("Your session has expired. Please sign in again.");
  }

  let response: Response;
  try {
    response = await fetch(`${collectorUrl()}/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ device_name: deviceName }),
    });
  } catch {
    /*
     * fetch yalnızca AĞ katmanında patlar ve CORS reddi de tam olarak böyle
     * görünür: tarayıcı yanıtı JavaScript'e hiç teslim etmez, durum kodu
     * okunamaz. İkisini ayırmak imkânsız olduğu için mesaj her ikisini de
     * kapsıyor — aksi hâlde kullanıcı çalışan bir sunucuyu "kapalı" sanırdı.
     */
    throw new Error(
      "Could not reach the collector. Check your connection, or its CORS allowlist if this is a new deployment.",
    );
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? null;
    } catch {
      // Gövde JSON değilse (proxy hata sayfası, boş 502) sessizce geç.
    }
    throw new Error(detail ?? `The collector returned ${response.status}.`);
  }

  return (await response.json()) as CreatedDevice;
}
