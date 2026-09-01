/**
 * Üst yatay araç çubuğu — `dashboard/example/2`'nin BİREBİR karşılığı.
 *
 * Görselde dört şey var: solda "All Hosts" seçicisi, sağda "Last 1 hour"
 * seçicisi, yenile düğmesi ve avatar. Önceki hâldeki arama kutusu ve uyarı
 * zili KALDIRILDI — ikisi de referansta yok. Zilin içeriği kaybolmadı,
 * Overview'daki Alerts kartına taşındı; orada zaten daha görünür.
 *
 * Tema düğmesi duruyor. Referansta yok ama §9.11.2 iki temayı kilitledi ve
 * düğmesiz bir tema seçilemez. Yenile düğmesiyle aynı kutu biçiminde, yani
 * görsel dile yeni bir öğe sokmuyor — sadece aynı ailede bir kutu daha.
 *
 * İki seçici de GERÇEK: host seçimi Overview'ın tamamını ve cihaz listesini
 * daraltıyor, zaman seçimi §9.8'in "zaman aralığı TEKTİR" kuralını taşıyor —
 * aynı seçim hem grafiği hem log listesini kapsıyor.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/lib/appState";
import { RANGES, type RangeKey } from "@/lib/logs";
import { SelectBox } from "./SelectBox";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconClock,
  IconLogout,
  IconMenu,
  IconRefresh,
} from "./icons";

/**
 * Aralıkların İngilizce etiketleri — görselde "Last 1 hour" yazıyor.
 * `RANGES`'in kendi etiketleri Türkçe ve cihaz detayında kullanılıyor; kabuk
 * İngilizce olduğu için burada ayrı bir eşleme var, `RANGES` çevrilmedi.
 */
const RANGE_LABEL: Record<RangeKey, string> = {
  "1h": "Last 1 hour",
  "24h": "Last 24 hours",
  "2d": "Last 2 days",
  "5d": "Last 5 days",
  "7d": "Last 7 days",
  "10d": "Last 10 days",
};

/** E-postadan tek harf — referansta avatarın içinde tek harf var. */
function initial(email: string): string {
  return (email.trim()[0] ?? "?").toUpperCase();
}

/**
 * Dışarı tıklayınca ve Escape'e basınca kapanan katman. Escape de kapatıyor —
 * açık bir katmandan çıkmanın klavyedeki karşılığı budur ve fareye uzanmadan
 * çalışır.
 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const {
    range,
    setRange,
    hostFilter,
    setHostFilter,
    refreshing,
    reload,
    devices,
    email,
  } = useApp();

  const [userOpen, setUserOpen] = useState(false);
  const user = useDismiss(userOpen, () => setUserOpen(false));

  const selected = devices?.find((d) => d.id === hostFilter) ?? null;

  return (
    <header className="sticky top-0 z-20 flex h-20 items-center gap-3 border-b border-line bg-bg-soft px-4 sm:px-6">
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-lg p-2 text-muted transition hover:bg-panel-2 hover:text-fg lg:hidden"
      >
        <IconMenu className="size-5" />
      </button>

      {/* --- host süzgeci (referans: sol uçta) ----------------------------- */}
      <SelectBox
        value={hostFilter ?? "all"}
        onChange={(v) => setHostFilter(v === "all" ? null : v)}
        label={selected ? selected.device_name : "All Hosts"}
        ariaLabel="Host filter"
      >
        <option value="all">All Hosts</option>
        {devices?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.device_name}
          </option>
        ))}
      </SelectBox>

      <div className="ml-auto flex items-center gap-2">
        {/* --- zaman aralığı ---------------------------------------------- */}
        <SelectBox
          value={range}
          onChange={(v) => setRange(v as RangeKey)}
          label={RANGE_LABEL[range]}
          icon={<IconClock className="size-4 shrink-0 text-muted" />}
          ariaLabel="Time range"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {RANGE_LABEL[r.key]}
            </option>
          ))}
        </SelectBox>

        <button
          onClick={reload}
          aria-label="Refresh"
          title="Refresh"
          className="rounded-lg border border-line bg-panel p-2.5 text-muted transition hover:text-fg"
        >
          <IconRefresh
            className={`size-[18px] ${refreshing ? "animate-spin" : ""}`}
          />
        </button>

        <ThemeToggle />

        {/* --- hesap (referans: sağ üstte avatar) --------------------------
            Menü kapalıyken ekranda yalnızca daire var, yani duruş referansla
            aynı; çıkış yolu da bir yerde bulunmak zorunda. */}
        <div ref={user} className="relative">
          <button
            onClick={() => setUserOpen((v) => !v)}
            aria-label="Account"
            className="grid size-9 place-items-center rounded-full bg-accent/25 text-sm font-semibold text-accent-strong transition hover:bg-accent hover:text-white"
          >
            {initial(email)}
          </button>

          {userOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-card border border-line bg-panel shadow-pop">
              <div className="border-b border-line px-4 py-3">
                <p className="truncate text-sm font-medium" title={email}>
                  {email.split("@")[0]}
                </p>
                {/*
                  "Rol" alanı referansta var. TraceBox'ta rol kavramı YOK —
                  accounts tablosunda tek sahip var, paylaşım veya ekip
                  üyeliği yok. Yazılan şey bu yüzden uydurma bir unvan değil.
                */}
                <p className="truncate text-xs text-faint">Account owner</p>
              </div>
              <button
                onClick={() => supabase().auth.signOut()}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-sm text-muted transition hover:bg-panel-2 hover:text-danger"
              >
                <IconLogout className="size-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
