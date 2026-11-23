/**
 * Cihaz kartı (CLAUDE.md §9.3).
 *
 * Kartın cevapladığı tek soru: "bu makine iyi mi?"
 * Bu yüzden üstünde AKSİYON BUTONU YOK — tıklayınca detaya gider, pause/sil
 * orada durur. Silme geri alınamaz bir iş; listede yanlışlıkla tıklanacak bir
 * yerde durmamalı.
 *
 * Üç ölçünün tanımı (adı, rengi, yüzdesi, okunur hâli) lib/metrics.ts'teki
 * SERIES'ten geliyor — detaydaki grafiklerle AYNI kaynak. Kartta RAM moru,
 * grafikte mavisi olsaydı kullanıcı iki ekranı zihninde eşleştiremezdi.
 */
"use client";

import Link from "next/link";
import { deviceStatus, type Device } from "@/lib/devices";
import { SERIES, type SeriesDef } from "@/lib/metrics";
import { relativeTime } from "@/lib/time";
import { StatusPill } from "@/components/StatusPill";
import { IconChevron, IconClock, IconServer } from "@/components/icons";

/*
 * Çubuğun rengi her zaman ölçünün kendi rengidir (`series.tone.bar`); değer
 * eşiğe ne kadar yakın olursa olsun renk değişmez. Yüzde değeri yazıyla
 * gösterilir.
 */

function Metric({
  series,
  percent,
  value,
}: {
  series: SeriesDef;
  percent: number | null;
  value: string;
}) {
  const clamped = percent == null ? null : Math.min(100, Math.max(0, percent));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{series.label}</span>
        <span
          className={`tabular-nums font-medium ${
            clamped == null ? "text-faint" : "text-fg"
          }`}
        >
          {value}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
        {clamped != null && (
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${series.tone.bar}`}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function DeviceCard({ device, now }: { device: Device; now: number }) {
  const status = deviceStatus(device, now);
  const m = device.latest;

  const subtitle =
    [
      [device.os_name, device.os_version].filter(Boolean).join(" "),
      device.cpu_cores_logical ? `${device.cpu_cores_logical} cores` : null,
      device.arch,
    ]
      .filter(Boolean)
      .join(" · ") || "envanter bekleniyor";

  return (
    <Link
      href={`/devices/${device.id}`}
      className="rise group flex flex-col rounded-card border border-line bg-panel shadow-card transition hover:border-accent/60 active:scale-[0.99]"
    >
      <div className="flex items-start gap-3 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-panel-2 text-fg">
          <IconServer className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium" title={device.device_name}>
            {device.device_name}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="space-y-3 px-5 pb-5">
        {SERIES.map((series) => (
          <Metric
            key={series.key}
            series={series}
            percent={m ? series.percent(m, device.ram_total_mb) : null}
            value={m ? series.display(m, device.ram_total_mb, device.disk_total_mb) : "—"}
          />
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
        <IconClock className="size-3.5 shrink-0 text-faint" />
        Seen {relativeTime(device.last_seen, now)}
        <IconChevron className="ml-auto size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>
    </Link>
  );
}
