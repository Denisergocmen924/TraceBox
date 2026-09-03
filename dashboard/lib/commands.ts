/**
 * Komut kuyruğuna yazma (CLAUDE.md §6 + §9.1).
 *
 * Dashboard cihaza DOĞRUDAN bir şey yaptırmaz; `commands` tablosuna bir satır
 * bırakır ve agent onu bir sonraki poll'unda (~10 sn) alır. Collector'a bir
 * "cihazı duraklat" ucu eklenmedi: agent zaten kuyruğu okuyor, ikinci bir yol
 * açmak aynı işi iki yerde tutmak olurdu (§9.1 — yazma yolu tabloya doğrudan
 * INSERT).
 *
 * Bunun görünür sonucu: butona basmak işi BİTİRMEZ, sıraya koyar. Arayüz bunu
 * saklamıyor — cihaz çevrimdışıysa komut, makine geri dönene kadar bekler.
 */
import { supabase } from "./supabase";

export type CommandType = "pause" | "resume" | "delete";

/**
 * `account_id` istemciden gidiyor: kolon NOT NULL ve varsayılanı yok.
 * Uydurulabilir görünüyor ama uydurulamaz — RLS'teki `ins_commands` hem bu
 * değerin auth.uid()'e eşit olmasını hem de device_id'nin AYNI hesaba ait
 * olmasını arıyor (§5). İkinci koşul olmasaydı saldırgan kendi account_id'siyle
 * kurbanın device_id'sine `delete` yazabilirdi; kontrol veritabanında, burada
 * değil.
 */
export async function queueCommand(params: {
  deviceId: string;
  accountId: string;
  type: CommandType;
}): Promise<void> {
  const { error } = await supabase().from("commands").insert({
    device_id: params.deviceId,
    account_id: params.accountId,
    type: params.type,
  });
  if (error) throw error;
}
