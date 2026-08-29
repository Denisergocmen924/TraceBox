/**
 * Cihaz detayının SAĞ paneli (CLAUDE.md §9.4).
 *
 * Dar panelin işi tek: "hangi makineye bakıyorum, ne durumda, ne yapabilirim".
 * Sayfa kaydırılırken yerinde kalır (sticky) — log listesinin dibine inen
 * kullanıcı hangi cihazın loglarını okuduğunu unutmasın diye.
 *
 * Oran 70/30, referans görselin 55/45'inden bilinçli sapma: oradaki sağ panel
 * bir form, bizimki iki buton ve künye. Buna karşılık log satırları uzun ve
 * dar alanda kırpılıyor — geniş olması gereken taraf sol.
 */
"use client";

import {
  deviceStatus,
  STATUS_LABEL,
  type DeviceDetail,
  type DeviceStatus,
} from "@/lib/devices";
import { gb, localDateTime, relativeTime } from "@/lib/time";

const STATUS_DOT: Record<DeviceStatus, string> = {
  online: "bg-ok",
  offline: "bg-muted",
  paused: "bg-warn",
  deleting: "bg-danger",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right" title={value}>
        {value}
      </span>
    </div>
  );
}

export function DetailPanel({
  device,
  now,
}: {
  device: DeviceDetail;
  now: number;
}) {
  const status = deviceStatus(device, now);

  return (
    <aside className="space-y-4 lg:sticky lg:top-8">
      <section className="rounded-xl border border-line bg-panel p-5">
        <h1 className="truncate text-lg font-semibold" title={device.device_name}>
          {device.device_name}
        </h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
          {STATUS_LABEL[status]}
        </p>

        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <Row
            label="İşletim sistemi"
            value={
              [device.os_name, device.os_version].filter(Boolean).join(" ") || "—"
            }
          />
          <Row label="Çekirdek" value={device.kernel_version ?? "—"} />
          <Row label="Mimari" value={device.arch ?? "—"} />
          <Row label="İşlemci" value={device.cpu_model ?? "—"} />
          <Row
            label="Çekirdek sayısı"
            value={
              device.cpu_cores_logical
                ? `${device.cpu_cores_logical} mantıksal` +
                  (device.cpu_cores_physical
                    ? ` · ${device.cpu_cores_physical} fiziksel`
                    : "")
                : "—"
            }
          />
          <Row label="RAM" value={gb(device.ram_total_mb)} />
          <Row label="Disk" value={gb(device.disk_total_mb)} />
          {device.gpu_model && <Row label="GPU" value={device.gpu_model} />}
          {device.external_ip && (
            <Row label="Dış IP" value={device.external_ip} />
          )}
        </div>

        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <Row label="Agent" value={device.agent_version ?? "—"} />
          <Row label="Açılış" value={localDateTime(device.last_boot)} />
          <Row label="Görülme" value={relativeTime(device.last_seen, now)} />
          {device.enabled_addons.length > 0 && (
            <Row label="Eklentiler" value={device.enabled_addons.join(", ")} />
          )}
        </div>
      </section>

      {/*
        Aksiyonlar bilerek DEVRE DIŞI. pause/resume/delete, commands tablosuna
        INSERT atmak kadar basit değil: silme geri alınamaz ve §9.10 her yıkıcı
        işlem için ayrı bir onay penceresi şart koşuyor (cihazın adını yazdırma,
        Enter/Esc'in güvenli tarafa düşmesi). O pencere yazılmadan butonu canlı
        bırakmak, kuralı kâğıt üstünde bırakmak olurdu.
      */}
      <section className="space-y-2 rounded-xl border border-line bg-panel p-5">
        <button
          disabled
          title="Onay penceresi ile birlikte gelecek (§9.10)"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {device.logging_enabled ? "Duraklat" : "Devam ettir"}
        </button>
        <button
          disabled
          title="Onay penceresi ile birlikte gelecek (§9.10)"
          className="w-full rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sil
        </button>
      </section>
    </aside>
  );
}
