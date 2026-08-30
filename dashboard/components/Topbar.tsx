/**
 * Üst yatay araç çubuğu (tasarım planı §4).
 *
 * Planın istediği beş öğeden dördü burada: arama, zaman aralığı seçici,
 * yenileme, uyarı zili.
 *
 * BEŞİNCİSİ — dark/light tema düğmesi — bilerek yapılmadı. CLAUDE.md §9.11
 * markayı tek bir koyu lacivert kimliğe bağlıyor ve landing (§9.12) de aynı
 * dili konuşacak. Çalışan bir açık tema, ikinci bir tam palet ve her ekranın
 * iki kez gözden geçirilmesi demek. Çalışmayan bir düğme koymak ise hiç
 * koymamaktan kötü: kullanıcı basar, bir şey olmaz.
 *
 * Zaman aralığı seçici toolbar'da duruyor çünkü §9.8 "zaman aralığı TEKTİR"
 * diyor — aynı seçim hem grafiği hem log listesini daraltıyor. Panel
 * başlığında dursaydı, aralığın log listesini de kapsadığı görünmezdi.
 * Cihaz listesi ekranında gizleniyor: orada zamanın bir karşılığı yok.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/appState";
import { buildAlerts, SEVERITY_LABEL, type AlertSeverity } from "@/lib/alerts";
import { RANGES } from "@/lib/logs";
import { relativeTime } from "@/lib/time";
import {
  IconAlert,
  IconBell,
  IconInfo,
  IconMenu,
  IconRefresh,
  IconSearch,
} from "./icons";

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  critical: "text-danger",
  warning: "text-warn",
  info: "text-info",
};

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  const className = `size-4 shrink-0 ${SEVERITY_TONE[severity]}`;
  return severity === "info" ? (
    <IconInfo className={className} />
  ) : (
    <IconAlert className={className} />
  );
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { query, setQuery, range, setRange, refreshing, reload, devices, now } =
    useApp();
  const pathname = usePathname();
  const onDetail = /^\/devices\/[^/]+$/.test(pathname);

  const [bellOpen, setBellOpen] = useState(false);
  const bell = useRef<HTMLDivElement>(null);

  const alerts = devices ? buildAlerts(devices, now) : [];
  // Zildeki sayı yalnızca MÜDAHALE gerektirenleri sayıyor. "Duraklatıldı"
  // (info) kullanıcının kendi kararı; onu da saymak, kullanıcının bilerek
  // yaptığı bir şeyi ona sürekli hatırlatmak olurdu.
  const actionable = alerts.filter((a) => a.severity !== "info").length;

  // Menü dışına tıklayınca kapanır. Escape de kapatır — açık bir katmandan
  // çıkmanın klavyedeki karşılığı budur ve fareye uzanmadan çalışır.
  useEffect(() => {
    if (!bellOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!bell.current?.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBellOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg-soft/85 px-4 backdrop-blur-md sm:px-6">
      <button
        onClick={onOpenMenu}
        aria-label="Menüyü aç"
        className="rounded-lg p-2 text-muted transition hover:bg-panel hover:text-fg lg:hidden"
      >
        <IconMenu className="size-5" />
      </button>

      {/* --- arama -------------------------------------------------------- */}
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cihaz ara…"
          aria-label="Cihaz ara"
          className="w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-3 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* --- zaman aralığı (yalnızca cihaz detayında) -------------------- */}
        {onDetail && (
          <div className="hidden items-center rounded-lg border border-line bg-panel p-0.5 md:flex">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  range === r.key
                    ? "bg-accent text-white"
                    : "text-muted hover:text-fg"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={reload}
          aria-label="Yenile"
          title="Yenile"
          className="rounded-lg border border-line bg-panel p-2 text-muted transition hover:text-fg"
        >
          <IconRefresh
            className={`size-[18px] ${refreshing ? "animate-spin" : ""}`}
          />
        </button>

        {/* --- uyarı zili --------------------------------------------------- */}
        <div ref={bell} className="relative">
          <button
            onClick={() => setBellOpen((v) => !v)}
            aria-label={`Uyarılar (${actionable})`}
            className="relative rounded-lg border border-line bg-panel p-2 text-muted transition hover:text-fg"
          >
            <IconBell className="size-[18px]" />
            {actionable > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold tabular-nums text-white">
                {actionable}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-card border border-line bg-panel shadow-2xl shadow-black/50">
              <p className="border-b border-line px-4 py-3 text-sm font-medium">
                Uyarılar
              </p>
              {alerts.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  Her şey yolunda.
                </p>
              ) : (
                <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto">
                  {alerts.map((alert) => (
                    <li key={alert.id}>
                      <Link
                        href={`/devices/${alert.deviceId}`}
                        onClick={() => setBellOpen(false)}
                        className="flex gap-3 px-4 py-3 transition hover:bg-panel-2"
                      >
                        <SeverityIcon severity={alert.severity} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{alert.title}</p>
                          <p className="mt-0.5 truncate text-xs text-faint">
                            {alert.deviceName} ·{" "}
                            {alert.at
                              ? relativeTime(new Date(alert.at).toISOString(), now)
                              : "zaman bilinmiyor"}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] font-medium ${SEVERITY_TONE[alert.severity]}`}
                        >
                          {SEVERITY_LABEL[alert.severity]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
