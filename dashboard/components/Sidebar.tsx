/**
 * Sol sabit navigasyon — `dashboard/example/2`'nin BİREBİR karşılığı.
 *
 * Önceki hâlde menü referanstan bilerek sapıyordu: yalnızca "Cihazlar" vardı,
 * altında hesabın cihazları listeleniyordu. Gerekçe "tıklanınca boş sayfa açan
 * menü ürünü olduğundan büyük gösterir" idi. Kullanıcı bu yorumu geri aldı ve
 * görselin aynen kopyalanmasını istedi (§9.11.1'in "birebir" kuralı); menü
 * artık referanstaki yedi öğe.
 *
 * İlk hâlde yalnızca ilk iki öğenin (Overview, Hosts) sayfası vardı; kalan beşi
 * tıklanmayan `<span>` olarak duruyordu — var olmayan bir sayfaya href vermek
 * kullanıcıyı 404'e koşturmak olurdu. 2026-08-31'de beşinin de kendi sayfası
 * yazıldı ve pasif dal kaldırıldı: menünün tamamı artık gerçekten çalışıyor.
 *
 * Genişlik 212px — görselden ölçüldü (kenar çizgisi x=212). Etiketler İngilizce,
 * yine görseldeki gibi.
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/appState";
import { OFFLINE_AFTER_SECONDS, type Device } from "@/lib/devices";
import {
  IconBell,
  IconChart,
  IconClose,
  IconFileText,
  IconHome,
  IconInventory,
  IconServer,
  IconSettings,
} from "./icons";

/** Sol alt kutudaki sürüm. Agent'ın değil, DASHBOARD'ın sürümü. */
const APP_VERSION = "v1.0.0";

type NavItem = {
  label: string;
  icon: (p: { className?: string }) => React.ReactElement;
  href: string;
  /** Aktiflik testi — /devices/<id> da "Hosts" sayılmalı. */
  match: (pathname: string) => boolean;
};

const NAV: NavItem[] = [
  {
    label: "Overview",
    icon: IconHome,
    href: "/overview",
    match: (p) => p === "/overview",
  },
  {
    label: "Hosts",
    icon: IconServer,
    href: "/devices",
    match: (p) => p.startsWith("/devices"),
  },
  {
    label: "Metrics",
    icon: IconChart,
    href: "/metrics",
    match: (p) => p === "/metrics",
  },
  {
    label: "Logs",
    icon: IconFileText,
    href: "/logs",
    match: (p) => p === "/logs",
  },
  {
    label: "Alerts",
    icon: IconBell,
    href: "/alerts",
    match: (p) => p === "/alerts",
  },
  {
    label: "Inventory",
    icon: IconInventory,
    href: "/inventory",
    match: (p) => p === "/inventory",
  },
  {
    label: "Settings",
    icon: IconSettings,
    href: "/settings",
    match: (p) => p === "/settings",
  },
];

/**
 * Referans 2'nin sol alt köşesindeki "Collector · Healthy" rozeti.
 *
 * Uydurulmadı, GERÇEK veriden türüyor: cihazlardan biri son 60 saniye içinde
 * görüldüyse veri yolunun tamamı (agent → collector → Supabase → tarayıcı)
 * o an çalışıyor demektir. Ayrı bir sağlık isteği atmıyoruz; zaten elimizde
 * olan bilgiyi okuyor.
 *
 * Üçüncü hâl önemli: hiç cihaz yokken "Healthy" demek bir şey KANITLAMAZ,
 * çünkü test edilecek bir yol yok. O yüzden orada başka bir şey yazıyor.
 */
function collectorState(devices: Device[] | null, now: number) {
  if (!devices || devices.length === 0) {
    return { label: "No hosts", tone: "bg-panel-2 text-faint", dot: "bg-faint" };
  }
  const fresh = devices.some(
    (d) =>
      d.last_seen != null &&
      now - Date.parse(d.last_seen) <= OFFLINE_AFTER_SECONDS * 1000,
  );
  return fresh
    ? { label: "Healthy", tone: "bg-ok-soft text-ok", dot: "bg-ok" }
    : { label: "Silent", tone: "bg-warn-soft text-warn", dot: "bg-warn" };
}

/** Menü satırının ortak gövdesi. */
function itemClass(active: boolean): string {
  return active
    ? "bg-accent-soft text-accent"
    : "text-muted transition hover:bg-panel-2 hover:text-fg";
}

export function Sidebar({
  open,
  onClose,
}: {
  /** Yalnızca dar ekranda anlamlı: geniş ekranda sidebar her zaman açık. */
  open: boolean;
  onClose: () => void;
}) {
  const { devices, now } = useApp();
  const pathname = usePathname();
  const collector = collectorState(devices, now);

  return (
    <>
      {/*
        Dar ekranda çekmece açıkken arkadaki karartma. Tıklanınca kapanır —
        çekmeceyi kapatmanın tek yolu küçük bir çarpı olsaydı, dokunmatik
        ekranda hedefi tutturmak zorlaşırdı.
      */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-(--sidebar-w) flex-col border-r border-line bg-bg-soft transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* --- marka -------------------------------------------------------
            Yükseklik üst çubukla AYNI (80px): iki çizgi ekranın karşı
            uçlarında buluşuyor ve kabuk tek parça görünüyor. Logo görselden
            alınmadı — kullanıcının tek istisnası buydu. */}
        <div className="flex h-20 shrink-0 items-center gap-2.5 px-5">
          <Image
            src="/tracebox-mark.png"
            alt=""
            width={160}
            height={160}
            priority
            className="size-8 shrink-0 rounded-lg"
          />
          <span className="text-[17px] font-semibold tracking-tight">
            TraceBox
          </span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto text-muted transition hover:text-fg lg:hidden"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {/* --- gezinme -----------------------------------------------------
            Seçili öğe DOLU değil, yumuşak mor bir hap — referansta da öyle.
            Dolu zemin daha çok bağırıyor; burada bağırması gereken bir şey
            yok, sadece "buradasın" demesi yeterli. */}
        <nav className="flex flex-col gap-3.5 px-3 pt-1">
          {NAV.map(({ label, icon: Icon, href, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={label}
                href={href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${itemClass(
                  active,
                )} ${active ? "font-medium" : ""}`}
              >
                <Icon className="size-[18px] shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* --- toplayıcı rozeti (referans 2, sol alt) ----------------------
            İki satır, aralarında çizgi: üstte durum, altta sürüm. */}
        <div className="mt-auto shrink-0 p-4">
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className={`size-2 shrink-0 rounded-full ${collector.dot}`} />
              <span className="text-[13px] font-medium">Collector</span>
              <span
                className={`ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${collector.tone}`}
              >
                {collector.label}
              </span>
            </div>
            <p className="border-t border-line px-3 py-2 text-xs text-muted">
              {APP_VERSION}
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
