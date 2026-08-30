/**
 * Uyarılar (tasarım planı §8 "Recent Alerts").
 *
 * TraceBox'ta uyarı diye AYRI BİR TABLO YOK ve bu dosya bir tane uydurmuyor.
 * Buradaki her satır, zaten ekranda olan veriden türetiliyor:
 *
 *   · cihaz sessiz      → devices.last_seen eskidi (60 sn, §9.3)
 *   · eşik aşıldı       → son metrik satırı agent'ın flush eşiğinin üstünde
 *   · eşiğe yaklaşıldı  → eşiğin 15 puan altına girildi
 *   · duraklatıldı      → devices.logging_enabled = false
 *
 * Yani "kritik" kelimesi keyfi bir tasarım tercihi değil: eşiği aşan bir
 * değer, agent'ın spool'u beklemeden ANINDA buluta boşalttığı değerdir.
 * Sunucuda bir alerting motoru olsaydı da tam olarak bu satırları üretirdi;
 * fark, hesabın tarayıcıda yapılması. Cihaz listesi zaten bellekte olduğu için
 * bu türetme fazladan tek bir sorgu bile açmıyor.
 *
 * Sıralama: önce ciddiyet, sonra tazelik. Zil menüsü kısa; en üstteki satır
 * kullanıcının ilk bakacağı yer olmalı.
 */
import { deviceStatus, type Device } from "./devices";
import { FLUSH_THRESHOLD, SERIES } from "./metrics";

export type AlertSeverity = "critical" | "warning" | "info";

export type Alert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  deviceId: string;
  deviceName: string;
  /** Olayın bilinen en son anı; yoksa null (hiç ölçüm gelmemiş cihaz). */
  at: number | null;
};

/**
 * Eşiğe "yaklaşma" payı. Kart çubuklarının sarıya döndüğü noktayla AYNI sayı
 * (DeviceCard: danger - 15). İki ekranın iki ayrı "dikkat" tanımı olsaydı,
 * sarı çubuklu bir cihaz zilde hiç görünmeyebilirdi.
 */
export const NEAR_THRESHOLD_MARGIN = 15;

const RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "kritik",
  warning: "uyarı",
  info: "bilgi",
};

export function buildAlerts(devices: Device[], now: number): Alert[] {
  const out: Alert[] = [];

  for (const device of devices) {
    const status = deviceStatus(device, now);
    const seen = device.last_seen ? Date.parse(device.last_seen) : null;

    if (status === "offline") {
      out.push({
        id: `${device.id}:offline`,
        severity: "critical",
        title: "Cihaz sessiz — agent ulaşılamıyor",
        deviceId: device.id,
        deviceName: device.device_name,
        at: seen,
      });
    }

    if (status === "deleting") {
      out.push({
        id: `${device.id}:deleting`,
        severity: "warning",
        title: "Silme emri bekliyor",
        deviceId: device.id,
        deviceName: device.device_name,
        at: seen,
      });
    }

    if (status === "paused") {
      out.push({
        id: `${device.id}:paused`,
        severity: "info",
        title: "Gönderim duraklatıldı — veri yerelde birikiyor",
        deviceId: device.id,
        deviceName: device.device_name,
        at: seen,
      });
    }

    // Eşik kontrolü yalnızca cihaz konuşuyorken anlamlı: sessiz bir cihazın
    // son metriği saatler öncesine ait olabilir ve "CPU %95" demek yanıltırdı.
    const m = device.latest;
    if (!m || status === "offline") continue;

    const at = Date.parse(m.measured_at);
    for (const series of SERIES) {
      const percent = series.percent(m, device.ram_total_mb);
      if (percent == null) continue;

      const limit = FLUSH_THRESHOLD[series.key];
      if (percent >= limit) {
        out.push({
          id: `${device.id}:${series.key}:over`,
          severity: "critical",
          title: `${series.label} eşiği aşıldı — %${percent.toFixed(0)}`,
          deviceId: device.id,
          deviceName: device.device_name,
          at,
        });
      } else if (percent >= limit - NEAR_THRESHOLD_MARGIN) {
        out.push({
          id: `${device.id}:${series.key}:near`,
          severity: "warning",
          title: `${series.label} eşiğe yaklaştı — %${percent.toFixed(0)}`,
          deviceId: device.id,
          deviceName: device.device_name,
          at,
        });
      }
    }
  }

  return out.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || (b.at ?? 0) - (a.at ?? 0),
  );
}
