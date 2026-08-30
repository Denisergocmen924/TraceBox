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
import { FLUSH_THRESHOLD, SERIES, type SeriesDef } from "@/lib/metrics";
import { relativeTime } from "@/lib/time";
import { NEAR_THRESHOLD_MARGIN } from "@/lib/alerts";
import { StatusPill } from "@/components/StatusPill";
import { IconChevron, IconClock, IconServer } from "@/components/icons";

/**
 * Çubuğun rengi normalde ÖLÇÜNÜN rengi (CPU indigo, RAM mor, Disk cyan) —
 * plan §2'nin "renk metric ayrımı yapar" maddesi. Eşiğe yaklaşıldığında
 * DURUM rengi devralıyor, çünkü o noktada kullanıcının bilmesi gereken şey
 * artık hangi ölçüye baktığı değil, sorunun kendisi.
 *
 * Eşikler agent'ın ACİL GÖNDERİM eşikleri (agent/config.example.toml: cpu 90,
 * ram 90, disk 95). Kırmızı çubuk keyfi bir tasarım kararı değil, tam olarak
 * şunu söylüyor: "agent bu değeri acil sayıp spool'u beklemeden flush ederdi".
 */
function tone(series: SeriesDef, percent: number | null) {
  if (percent == null) return { bar: "bg-line", text: "text-faint" };
  const limit = FLUSH_THRESHOLD[series.key];
  if (percent >= limit) return { bar: "bg-danger", text: "text-danger" };
  if (percent >= limit - NEAR_THRESHOLD_MARGIN)
    return { bar: "bg-warn", text: "text-warn" };
  return { bar: series.tone.bar, text: "text-fg" };
}

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
  const { bar, text } = tone(series, clamped);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{series.label}</span>
        <span className={`tabular-nums font-medium ${text}`}>{value}</span>
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
      device.cpu_cores_logical ? `${device.cpu_cores_logical} çekirdek` : null,
      device.arch,
    ]
      .filter(Boolean)
      .join(" · ") || "envanter bekleniyor";

  return (
    <Link
      href={`/devices/${device.id}`}
      className="group flex flex-col rounded-card border border-line bg-panel transition hover:border-accent/60 hover:bg-panel-2/40"
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
        {relativeTime(device.last_seen, now)} görüldü
        <IconChevron className="ml-auto size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>
    </Link>
  );
}
