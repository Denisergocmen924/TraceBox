/**
 * Canlı akış (CLAUDE.md §9.9).
 *
 * Bağlantı TARAYICI ↔ SUPABASE REALTIME; Fly yolda değil (§9.1). Agent →
 * collector → Supabase'e giren her satır, açık duran WebSocket üzerinden
 * doğrudan ekrana düşüyor. F5 zorunluluğu yok.
 *
 * İKİ abone var ve ikisi ekranda farklı şeyler yapıyor:
 *   • `subscribeLogs`  — satırın KENDİSİ ekrana basılıyor (LogList).
 *   • `subscribeMetrics` — satırın kendisi KULLANILMIYOR; yalnızca "yeni veri
 *     geldi" haberi olarak okunuyor ve zaman penceresinin sağ kenarını
 *     ilerletiyor (appState). Grafiği tarayıcıda yeniden toplamak, seyreltmeyi
 *     iki ayrı yerde (bir kez SQL'de, bir kez burada) hesaplamak olurdu; iki
 *     hesap er ya da geç birbirinden ayrılır ve kullanıcı hangisinin doğru
 *     olduğunu bilemezdi. Kova hesabı TEK yerde, metrics_buckets'ta kalıyor.
 *
 * Güvenlik: Realtime de RLS'e tabi. Abonelik, oturumun access token'ı ile
 * kuruluyor; kullanıcı yalnızca kendi `account_id`'sine ait satırları alıyor.
 * `device_id` süzgeci bunun ÜSTÜNE bir daraltma — güvenlik değil, trafik
 * tasarrufu: cihaz detay ekranı zaten tek bir makineye bakıyor.
 *
 * Bu modül SADECE taşıma katmanı. Saniyede bir güncelleme ve ~500 satır
 * tavanları (§9.9'un zorunlu kıldığı iki sınır) çağıran tarafta: tavanlar
 * ekranın davranışıyla ilgili, kanalın değil.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { LogRow } from "./logs";

/**
 * Metrik aboneliğinden okunan tek şey. Satırın on beş sütunu da geliyor ama
 * burada TÜRÜ dar tutmak bilerek: ileride biri bu satırı grafiğe çizmeye
 * kalkarsa derleyici durdursun — çizim yolu metrics_buckets'tan geçmeli.
 */
export type MetricPing = { device_id: string; measured_at: string };

/**
 * INSERT aboneliğinin ortak gövdesi.
 *
 * İki genel kural burada bir kez yazılıyor: token elle veriliyor ve kanal
 * `SUBSCRIBED` olmadan "canlı" sayılmıyor. Her abone bunu kendi kopyasında
 * taşısaydı, birinde düzeltilen bir hata ötekinde kalırdı.
 */
function subscribeInserts<T>(params: {
  table: string;
  deviceId: string | null;
  onInsert: (row: T) => void;
  onStatus?: (live: boolean) => void;
}): () => void {
  const { table, deviceId, onInsert, onStatus } = params;
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
      .channel(`${table}:${deviceId ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table,
          // Süzgeç YOKSA alan da yazılmıyor: boş bir filtre dizesi
          // Realtime tarafında hiçbir satırla eşleşmez, yani kanal sessizce
          // ölü kalırdı.
          ...(deviceId ? { filter: `device_id=eq.${deviceId}` } : {}),
        },
        (payload) => onInsert(payload.new as T),
      )
      .subscribe((status) => {
        // "SUBSCRIBED" dışındaki her hâl (CHANNEL_ERROR, TIMED_OUT, CLOSED)
        // canlı DEĞİL. Rozeti yalnızca gerçekten bağlıyken göstermek şart:
        // "Live" yazıp satır akıtmamak, kullanıcıya hiç veri üretilmediğini
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
  return subscribeInserts<LogRow>({ table: "logs", ...params });
}

/**
 * Yeni metrik satırlarına abone ol — pencerenin sağ kenarını ilerletmek için.
 *
 * `deviceId` bilerek YOK: kenar duvar saatindeki "şu an"ı gösteriyor, tek bir
 * makinenin en son ölçümünü değil. Cihaza süzseydik, o makine duraklatılmış
 * ya da çevrimdışıyken kenar donar; kullanıcı ekranın canlı olmadığını değil,
 * ZAMANIN durduğunu görürdü. Hesabın tamamını dinlemek RLS sayesinde zaten
 * güvenli ve tek bir kanal, sayfadaki her grafiğe yetiyor.
 */
export function subscribeMetrics(params: {
  onInsert: (row: MetricPing) => void;
  onStatus?: (live: boolean) => void;
}): () => void {
  return subscribeInserts<MetricPing>({
    table: "metrics",
    deviceId: null,
    ...params,
  });
}
