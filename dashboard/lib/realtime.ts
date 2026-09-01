/**
 * Canlı log akışı (CLAUDE.md §9.9).
 *
 * Bağlantı TARAYICI ↔ SUPABASE REALTIME; Fly yolda değil (§9.1). Agent →
 * collector → Supabase'e giren her satır, açık duran WebSocket üzerinden
 * doğrudan ekrana düşüyor. F5 zorunluluğu yok.
 *
 * Güvenlik: Realtime de RLS'e tabi. Abonelik, oturumun access token'ı ile
 * kuruluyor; kullanıcı yalnızca kendi `account_id`'sine ait satırları alıyor.
 * `device_id` süzgeci bunun ÜSTÜNE bir daraltma — güvenlik değil, trafik
 * tasarrufu: cihaz detay ekranı zaten tek bir makineye bakıyor.
 *
 * Bu modül SADECE taşıma katmanı. Saniyede bir güncelleme ve ~500 satır
 * tavanları (§9.9'un zorunlu kıldığı iki sınır) çağıran tarafta, LogList'te:
 * tavanlar ekranın davranışıyla ilgili, kanalın değil.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { LogRow } from "./logs";

/**
 * Bir cihazın yeni log satırlarına abone ol.
 *
 * Dönen fonksiyon aboneliği kapatır. Kapatmak ZORUNLU: her abonelik açık bir
 * kanal demek ve kullanıcı cihazlar arasında gezindikçe kanallar birikirdi;
 * Supabase'in kanal sayısı planla sınırlı.
 */
export function subscribeLogs(params: {
  /** `null` = hesabın tümü (Logs sayfası). Süzgeç düşer, RLS kalır. */
  deviceId: string | null;
  onInsert: (row: LogRow) => void;
  /** Kanalın gerçekten kurulup kurulmadığı — ekranda "Live" rozetini bu belirler. */
  onStatus?: (live: boolean) => void;
}): () => void {
  const { deviceId, onInsert, onStatus } = params;
  const client = supabase();

  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  /*
   * Token'ı elle veriyoruz. İstemci oturumu zaten biliyor ama Realtime'ın
   * kendi kimlik doğrulaması ayrı bir yolda ilerliyor; token verilmezse
   * bağlantı anon olarak kurulur ve RLS hiçbir satır göstermez — ekran
   * sessizce boş kalırdı, hata da vermezdi.
   */
  client.auth.getSession().then(({ data }) => {
    if (cancelled) return;

    const token = data.session?.access_token;
    if (token) client.realtime.setAuth(token);

    channel = client
      .channel(`logs:${deviceId ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "logs",
          // Süzgeç YOKSA alan da yazılmıyor: boş bir filtre dizesi
          // Realtime tarafında hiçbir satırla eşleşmez, yani kanal sessizce
          // ölü kalırdı.
          ...(deviceId ? { filter: `device_id=eq.${deviceId}` } : {}),
        },
        (payload) => onInsert(payload.new as LogRow),
      )
      .subscribe((status) => {
        // "SUBSCRIBED" dışındaki her hâl (CHANNEL_ERROR, TIMED_OUT, CLOSED)
        // canlı DEĞİL. Rozeti yalnızca gerçekten bağlıyken göstermek şart:
        // "Live" yazıp satır akıtmamak, kullanıcıya hiç log gelmediğini
        // söylemek olurdu.
        onStatus?.(status === "SUBSCRIBED");
      });
  });

  return () => {
    cancelled = true;
    onStatus?.(false);
    if (channel) client.removeChannel(channel);
  };
}
