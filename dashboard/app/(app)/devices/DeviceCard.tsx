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
import { percentTone } from "@/lib/alerts";
import { StatusPill } from "@/components/StatusPill";
import {
  IconAlert,
  IconChevron,
  IconClock,
  IconServer,
} from "@/components/icons";

/*
 * Çubuğun rengi normalde ÖLÇÜNÜN rengi (CPU mor, RAM yeşil, Disk turuncu —
 * referans 2'nin dört kartı). Eşiğe yaklaşıldığında DURUM rengi devralıyor,
 * çünkü o noktada kullanıcının bilmesi gereken şey artık hangi ölçüye baktığı
 * değil, sorunun kendisi. Hesap lib/alerts.ts'te: aynı eşik Overview'daki
 * Host Status tablosunda ve Top Hosts çubuklarında da okunuyor.
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
  const { bar, text, alarm } = percentTone(series, clamped);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{series.label}</span>
        <span className={`flex items-center gap-1 tabular-nums font-medium ${text}`}>
          {/*
            Uyarı üçgeni, çubuk rengine ek bir sinyal. Disk rengi (turuncu) ile
            uyarı kehribarı yakın akraba; sinyal yalnızca çubuğa bırakılsaydı
            "disk eşiğe yaklaştı" hâli, normal disk çubuğundan ayırt edilemezdi.
          */}
          {alarm && <IconAlert className="size-3.5 shrink-0" />}
          {value}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
        {clamped != null && (
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${bar}`}
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
      className="group flex flex-col rounded-card border border-line bg-panel shadow-card transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop"
    >
      <div className="flex items-start gap-3 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
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
            value={m ? series.display(m, device.ram_total_mb) : "—"}
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
