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
 *
 * Künye üç bloğa ayrıldı: DONANIM (değişmez), SİSTEM (yeniden kurulumla
 * değişir), AGENT (sürekli değişir). Tek uzun liste olduğunda göz "RAM
 * nerede" diye baştan taramak zorunda kalıyordu.
 */
"use client";

import {
  deviceStatus,
  type DeviceDetail,
} from "@/lib/devices";
import { gb, localDateTime, relativeTime } from "@/lib/time";
import { StatusPill } from "@/components/StatusPill";
import {
  IconPause,
  IconPlay,
  IconServer,
  IconTrash,
} from "@/components/icons";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums" title={value}>
        {value}
      </span>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-faint">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
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
    <aside className="space-y-5 lg:sticky lg:top-22">
      <section className="overflow-hidden rounded-card border border-line bg-panel">
        <div className="flex items-start gap-3 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <IconServer className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate font-semibold"
              title={device.device_name}
            >
              {device.device_name}
            </h1>
            <div className="mt-2">
              <StatusPill status={status} />
            </div>
          </div>
        </div>

        <Group title="DONANIM">
          <Row label="İşlemci" value={device.cpu_model ?? "—"} />
          <Row
            label="Çekirdek"
            value={
              device.cpu_cores_logical
                ? `${device.cpu_cores_logical} mantıksal` +
                  (device.cpu_cores_physical
                    ? ` · ${device.cpu_cores_physical} fiziksel`
                    : "")
                : "—"
            }
          />
          <Row label="Mimari" value={device.arch ?? "—"} />
          <Row label="RAM" value={gb(device.ram_total_mb)} />
          <Row label="Disk" value={gb(device.disk_total_mb)} />
          {device.gpu_model && <Row label="GPU" value={device.gpu_model} />}
        </Group>

        <Group title="SİSTEM">
          <Row
            label="İşletim sistemi"
            value={
              [device.os_name, device.os_version].filter(Boolean).join(" ") ||
              "—"
            }
          />
          <Row label="Çekirdek sürümü" value={device.kernel_version ?? "—"} />
          <Row label="Açılış" value={localDateTime(device.last_boot)} />
          {device.external_ip && (
            <Row label="Dış IP" value={device.external_ip} />
          )}
        </Group>

        <Group title="AGENT">
          <Row label="Sürüm" value={device.agent_version ?? "—"} />
          <Row label="Görülme" value={relativeTime(device.last_seen, now)} />
          <Row
            label="Gönderim"
            value={device.logging_enabled ? "açık" : "duraklatıldı"}
          />
          {device.enabled_addons.length > 0 && (
            <Row label="Eklentiler" value={device.enabled_addons.join(", ")} />
          )}
        </Group>
      </section>

      {/*
        Aksiyonlar bilerek DEVRE DIŞI. pause/resume/delete, commands tablosuna
        INSERT atmak kadar basit değil: silme geri alınamaz ve §9.10 her yıkıcı
        işlem için ayrı bir onay penceresi şart koşuyor (cihazın adını yazdırma,
        Enter/Esc'in güvenli tarafa düşmesi). O pencere yazılmadan butonu canlı
        bırakmak, kuralı kâğıt üstünde bırakmak olurdu.

        "Sil" butonu vurgusuz duruyor (dolu kırmızı değil, kırmızı kenarlıklı):
        §9.10 "tehlikeli buton vurgusuzdur" diyor — göz önce güvenli seçeneğe
        gitmeli.
      */}
      <section className="space-y-2 rounded-card border border-line bg-panel p-4">
        <button
          disabled
          title="Onay penceresi ile birlikte gelecek (§9.10)"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm font-medium transition hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {device.logging_enabled ? (
            <IconPause className="size-4" />
          ) : (
            <IconPlay className="size-4" />
          )}
          {device.logging_enabled ? "Duraklat" : "Devam ettir"}
        </button>
        <button
          disabled
          title="Onay penceresi ile birlikte gelecek (§9.10)"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-danger/40 px-3 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconTrash className="size-4" />
          Sil
        </button>
      </section>
    </aside>
  );
}
