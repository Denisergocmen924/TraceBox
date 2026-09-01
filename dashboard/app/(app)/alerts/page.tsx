/**
 * Alerts — kenar çubuğundaki "Alerts" bölümünün sayfası.
 *
 * Overview'daki kart en ciddi ÜÇ satırı gösteriyor (referanstaki sayı); burası
 * tamamı. Fark yalnızca uzunluk değil: kart bir bakış, bu sayfa bir çalışma
 * yeri — satırlar ciddiyete göre gruplu ve her grup kaç tane olduğunu yazıyor.
 *
 * TraceBox'ta uyarı diye AYRI BİR TABLO YOK ve bu sayfa bir tane uydurmuyor.
 * Her satır zaten bellekte olan cihaz listesinden türüyor (lib/alerts.ts):
 * sessiz cihaz, agent'ın acil gönderim eşiğini aşan bir ölçü, eşiğe 15 puan
 * yaklaşmış bir ölçü, duraklatılmış gönderim. Yani sayfa fazladan tek bir
 * sorgu bile açmıyor.
 *
 * Bu, sayfanın en alttaki açıklama kutusunda kullanıcıya da SÖYLENİYOR.
 * Söylenmezse "Critical" rozeti, arkasında bir alarm motoru varmış izlenimi
 * verir; oysa satır, cihaz listesi tazelendiği anda kendiliğinden kaybolabilir.
 * Seyreltilmiş grafiğin "her nokta = X" satırıyla aynı dürüstlük kuralı
 * (§9.6 madde 5).
 */
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import {
  NEAR_THRESHOLD_MARGIN,
  SEVERITY_LABEL,
  buildAlerts,
  type Alert,
  type AlertSeverity,
} from "@/lib/alerts";
import type { Device } from "@/lib/devices";
import { FLUSH_THRESHOLD } from "@/lib/metrics";
import { OFFLINE_AFTER_SECONDS } from "@/lib/devices";
import { clockTime, relativeTime } from "@/lib/time";
import { PageHeader, Tally } from "@/components/PageHeader";
import { IconAlert, IconChevron } from "@/components/icons";

const TONE: Record<
  AlertSeverity,
  { icon: string; badge: string; rail: string }
> = {
  critical: {
    icon: "text-danger",
    badge: "bg-danger-soft text-danger",
    rail: "bg-danger",
  },
  warning: {
    icon: "text-warn",
    badge: "bg-warn-soft text-warn",
    rail: "bg-warn",
  },
  info: { icon: "text-info", badge: "bg-info-soft text-info", rail: "bg-info" },
};

/** Ciddiyet sırası — lib/alerts.ts'in sıralamasıyla aynı. */
const ORDER: AlertSeverity[] = ["critical", "warning", "info"];

function Row({ alert, now }: { alert: Alert; now: number }) {
  const tone = TONE[alert.severity];
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        href={`/devices/${alert.deviceId}`}
        className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-panel-2"
      >
        {/* Soldaki renk şeridi: göz listeyi tararken ciddiyeti rozeti okumadan
            yakalıyor. Rozet yine duruyor — renk tek başına erişilebilir değil. */}
        <span className={`h-8 w-1 shrink-0 rounded-full ${tone.rail}`} />
        <IconAlert className={`size-4 shrink-0 ${tone.icon}`} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={alert.title}>
            {alert.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-faint">
            {alert.deviceName}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone.badge}`}
        >
          {SEVERITY_LABEL[alert.severity]}
        </span>

        <span className="hidden w-28 shrink-0 text-right text-xs tabular-nums text-faint sm:block">
          {/* İki zaman biçimi bilerek yan yana: saat "ne zaman"ı, göreli süre
              "ne kadar önce"yi cevaplıyor. Uzun sessizliklerde ikincisi tek
              başına yeterli olmuyor, kısa olanlarda birincisi. */}
          {alert.at == null
            ? "—"
            : `${clockTime(alert.at)} · ${relativeTime(new Date(alert.at).toISOString(), now)}`}
        </span>

        <IconChevron className="size-4 shrink-0 text-faint" />
      </Link>
    </li>
  );
}

export default function AlertsPage() {
  const { devices, error, now, hostFilter } = useApp();

  const scoped = useMemo<Device[]>(() => {
    if (!devices) return [];
    return hostFilter ? devices.filter((d) => d.id === hostFilter) : devices;
  }, [devices, hostFilter]);

  const alerts = useMemo(() => buildAlerts(scoped, now), [scoped, now]);

  const grouped = useMemo(() => {
    const map = new Map<AlertSeverity, Alert[]>();
    for (const severity of ORDER) map.set(severity, []);
    for (const alert of alerts) map.get(alert.severity)?.push(alert);
    return map;
  }, [alerts]);

  const scopeName =
    hostFilter && devices
      ? (devices.find((d) => d.id === hostFilter)?.device_name ?? null)
      : null;

  const count = (s: AlertSeverity) => grouped.get(s)?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1248px]">
      <PageHeader
        title="Alerts"
        description="Conditions the agents would act on right now."
        scope={scopeName}
      >
        {devices && (
          <div className="flex divide-x divide-line">
            <Tally value={count("critical")} label="Critical" tone="text-danger" />
            <Tally value={count("warning")} label="Warning" tone="text-warn" />
            <Tally value={count("info")} label="Info" tone="text-info" />
          </div>
        )}
      </PageHeader>

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read hosts: {error}
        </p>
      )}

      {devices && alerts.length === 0 && (
        <p className="rounded-card border border-line bg-panel p-12 text-center text-sm text-muted shadow-card">
          {devices.length === 0 ? (
            <>
              No hosts yet. Add one from{" "}
              <Link href="/devices" className="font-medium text-accent">
                Hosts
              </Link>
              .
            </>
          ) : (
            "Nothing to report — every host is reachable and under its thresholds."
          )}
        </p>
      )}

      <div className="space-y-6">
        {ORDER.filter((severity) => count(severity) > 0).map((severity) => (
          <section
            key={severity}
            className="overflow-hidden rounded-card border border-line bg-panel shadow-card"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-semibold">
                {SEVERITY_LABEL[severity]}
              </h2>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TONE[severity].badge}`}
              >
                {count(severity)}
              </span>
            </div>
            <ul>
              {grouped.get(severity)?.map((alert) => (
                <Row key={alert.id} alert={alert} now={now} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* --- ne sayılır, ne sayılmaz -------------------------------------- */}
      <section className="mt-6 rounded-card border border-line bg-bg-soft p-5">
        <h2 className="text-[13px] font-semibold">How these are derived</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          TraceBox has no alert table and no alerting engine. Every row above is
          computed in your browser from the host list you are already looking
          at, so it appears and disappears with the data itself — there is
          nothing to acknowledge or silence.
        </p>
        <ul className="mt-3 space-y-1.5 text-xs text-muted">
          <li>
            <span className="font-medium text-fg">Host silent</span> — no
            contact for {OFFLINE_AFTER_SECONDS} seconds, six missed command
            polls in a row.
          </li>
          <li>
            <span className="font-medium text-fg">Usage above threshold</span> —
            the latest sample crossed the level at which the agent flushes its
            spool immediately: CPU {FLUSH_THRESHOLD.cpu}%, memory{" "}
            {FLUSH_THRESHOLD.ram}%, disk {FLUSH_THRESHOLD.disk}%.
          </li>
          <li>
            <span className="font-medium text-fg">High usage</span> — within{" "}
            {NEAR_THRESHOLD_MARGIN} points of that same level.
          </li>
          <li>
            <span className="font-medium text-fg">Shipping paused</span> /{" "}
            <span className="font-medium text-fg">Delete pending</span> — a
            command you queued is in effect or still waiting for the agent.
          </li>
        </ul>
      </section>
    </div>
  );
}
