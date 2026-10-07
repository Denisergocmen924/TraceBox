/**
 * Telefon alt sekme çubuğu — başparmakla ulaşılan beş hedef. Geniş ekranda
 * gizli (kenar çubuğu var). Yedi menü öğesinin kalanı "More" ile çekmecede.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconChart,
  IconFileText,
  IconHome,
  IconServer,
  IconSettings,
} from "./icons";

const TABS = [
  { label: "Overview", href: "/overview", icon: IconHome, match: (p: string) => p === "/overview" },
  { label: "Hosts", href: "/devices", icon: IconServer, match: (p: string) => p.startsWith("/devices") },
  { label: "Metrics", href: "/metrics", icon: IconChart, match: (p: string) => p === "/metrics" },
  { label: "Logs", href: "/logs", icon: IconFileText, match: (p: string) => p === "/logs" },
];

export function TabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const base =
    "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors";

  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 backdrop-blur-md lg:hidden"
    >
      <div className="flex h-(--tabbar-h)">
        {TABS.map(({ label, href, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`${base} ${active ? "font-medium text-accent" : "text-muted"}`}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
        <button onClick={onMore} className={`${base} text-muted`}>
          <IconSettings className="size-5" />
          More
        </button>
      </div>
    </nav>
  );
}
