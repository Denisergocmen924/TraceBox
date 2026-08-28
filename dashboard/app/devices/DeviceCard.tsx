/**
 * Cihaz kartı (CLAUDE.md §9.3).
 *
 * Kartın cevapladığı tek soru: "bu makine iyi mi?"
 * Bu yüzden üstünde AKSİYON BUTONU YOK — tıklayınca detaya gider, pause/sil
 * orada durur. Silme geri alınamaz bir iş; listede yanlışlıkla tıklanacak bir
 * yerde durmamalı.
 */
"use client";

import Link from "next/link";
import {
  deviceStatus,
  STATUS_LABEL,
  type Device,
  type DeviceStatus,
} from "@/lib/devices";
import { gb, relativeTime } from "@/lib/time";

const STATUS_DOT: Record<DeviceStatus, string> = {
  online: "bg-ok",
  offline: "bg-muted",
  paused: "bg-warn",
  deleting: "bg-danger",
};

/**
 * Çubuk rengi eşikleri, agent'ın ACİL GÖNDERİM eşiklerinin aynısı
 * (agent/config.example.toml: cpu 90, ram 90, disk 95). Böylece kırmızı çubuk
 * keyfi bir tasarım kararı değil, tam olarak şu anlama gelir: "agent bu değeri
 * acil sayıp anında flush ederdi". Sarı, ona yaklaşıldığını gösteren erken uyarı.
 */
function barColor(percent: number, danger: number): string {
  if (percent >= danger) return "bg-danger";
  if (percent >= danger - 15) return "bg-warn";
  return "bg-muted";
}

function Bar({
  label,
  percent,
  value,
  danger,
}: {
  label: string;
  percent: number | null;
  value: string;
  danger: number;
}) {
  const pct = percent == null ? null : Math.min(100, Math.max(0, percent));

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-10 shrink-0 text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
        {pct != null && (
          <div
            className={`h-full rounded-full ${barColor(pct, danger)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-muted">
        {value}
      </span>
    </div>
  );
}

export function DeviceCard({ device, now }: { device: Device; now: number }) {
  const status = deviceStatus(device, now);
  const m = device.latest;

  const ramPercent =
    m?.ram_used_mb != null && device.ram_total_mb
      ? (m.ram_used_mb / device.ram_total_mb) * 100
      : null;

  return (
    <Link
      href={`/devices/${device.id}`}
      className="block rounded-xl border border-line bg-panel p-5 transition hover:border-accent"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
            />
            <h2 className="truncate font-medium">{device.device_name}</h2>
          </div>
          <p className="mt-1 truncate text-sm text-muted">
            {[
              [device.os_name, device.os_version].filter(Boolean).join(" "),
              device.cpu_cores_logical
                ? `${device.cpu_cores_logical} çekirdek`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "envanter bekleniyor"}
          </p>
        </div>
        <span className="shrink-0 text-sm text-muted">
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="mt-5 space-y-2.5">
        <Bar
          label="CPU"
          percent={m?.cpu_percent ?? null}
          value={m?.cpu_percent != null ? `${m.cpu_percent.toFixed(0)}%` : "—"}
          danger={90}
        />
        <Bar
          label="RAM"
          percent={ramPercent}
          value={
            m?.ram_used_mb != null
              ? `${gb(m.ram_used_mb)} / ${gb(device.ram_total_mb)}`
              : "—"
          }
          danger={90}
        />
        <Bar
          label="Disk"
          percent={m?.disk_percent ?? null}
          value={
            m?.disk_percent != null ? `${m.disk_percent.toFixed(0)}%` : "—"
          }
          danger={95}
        />
      </div>

      <p className="mt-5 text-sm text-muted">
        {relativeTime(device.last_seen, now)} görüldü
      </p>
    </Link>
  );
}
