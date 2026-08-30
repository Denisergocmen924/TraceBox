/**
 * Sol sabit navigasyon (tasarım planı §3).
 *
 * Üstte logo + wordmark, ortada gezinme, altta kullanıcı profili — referans
 * görselin yerleşimi birebir bu.
 *
 * Menü listesi planınkinden FARKLI ve fark bilerek: plan Services, Containers,
 * Traces, Dashboards istiyor; TraceBox ajanı bunların hiçbirini toplamıyor.
 * Planın kendi §12 maddesi de "metric'leri agent'ın gerçekten topladığı
 * verilerle sınırla" diyor. Tıklanınca boş sayfa açan bir menü, gezinmeyi
 * kolaylaştırmaz — sadece ürünü olduğundan büyük gösterir.
 *
 * Sidebar'ın görsel yoğunluğu bunun yerine GERÇEK veriden geliyor: hesabın
 * cihazları isim isim listeleniyor. Hem referanstaki dolu his korunuyor, hem
 * de bu liste gerçekten işe yarıyor — cihaz detayındayken başka bir cihaza
 * geçmek için listeye dönmek gerekmiyor.
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/lib/appState";
import { deviceStatus } from "@/lib/devices";
import { IconClose, IconLogout, IconServer } from "./icons";
import { StatusDot } from "./StatusPill";

/** E-postadan iki harf: "denisergocmen@gmail.com" → "DE". */
function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

export function Sidebar({
  open,
  onClose,
}: {
  /** Yalnızca dar ekranda anlamlı: geniş ekranda sidebar her zaman açık. */
  open: boolean;
  onClose: () => void;
}) {
  const { devices, now, email } = useApp();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/devices/")
    ? pathname.split("/")[2]
    : null;

  return (
    <>
      {/*
        Dar ekranda çekmece açıkken arkadaki karartma. Tıklanınca kapanır —
        çekmeceyi kapatmanın tek yolu küçük bir çarpı olsaydı, dokunmatik
        ekranda hedefi tutturmak zorlaşırdı.
      */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-bg-soft transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* --- marka ------------------------------------------------------ */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
          <Image
            src="/tracebox-mark.png"
            alt=""
            width={160}
            height={160}
            priority
            className="size-9 shrink-0 rounded-full"
          />
          {/*
            Wordmark: TRACE beyaz, BOX accent (plan §3). Marka renginin ekranda
            göründüğü ilk yer burası; aynı indigo aşağıda seçili menü ve bütün
            aksiyon butonlarında tekrar ediyor.
          */}
          <span className="text-[15px] font-semibold tracking-[0.18em]">
            TRACE<span className="text-accent">BOX</span>
          </span>
          <button
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="ml-auto text-muted transition hover:text-fg lg:hidden"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {/* --- gezinme ---------------------------------------------------- */}
        <nav className="px-3 py-4">
          <Link
            href="/devices"
            onClick={onClose}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              pathname.startsWith("/devices")
                ? "bg-accent text-white"
                : "text-muted hover:bg-panel hover:text-fg"
            }`}
          >
            <IconServer className="size-[18px] shrink-0" />
            Cihazlar
            {devices && (
              <span
                className={`ml-auto rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
                  pathname.startsWith("/devices")
                    ? "bg-white/15"
                    : "bg-panel-2 text-faint"
                }`}
              >
                {devices.length}
              </span>
            )}
          </Link>
        </nav>

        {/* --- cihazlar --------------------------------------------------- */}
        <div className="flex min-h-0 flex-1 flex-col border-t border-line pt-4">
          <p className="px-6 pb-2 text-[11px] font-semibold tracking-[0.12em] text-faint">
            CİHAZLAR
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {devices?.length === 0 && (
              <p className="px-3 py-2 text-xs text-faint">Henüz cihaz yok.</p>
            )}
            {devices?.map((device) => (
              <Link
                key={device.id}
                href={`/devices/${device.id}`}
                onClick={onClose}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  activeId === device.id
                    ? "bg-accent-soft text-fg"
                    : "text-muted hover:bg-panel hover:text-fg"
                }`}
              >
                <StatusDot status={deviceStatus(device, now)} />
                <span className="truncate">{device.device_name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* --- kullanıcı (plan §3: avatar + isim + rol) -------------------- */}
        <div className="shrink-0 border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
              {initials(email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={email}>
                {email.split("@")[0]}
              </p>
              {/*
                "Rol" alanı planda var. TraceBox'ta rol kavramı YOK — accounts
                tablosunda tek bir sahip var, paylaşım veya ekip üyeliği yok.
                Yazılan şey bu yüzden uydurma bir unvan değil, olduğu gibi
                gerçek: bu hesabın sahibi.
              */}
              <p className="truncate text-xs text-faint">Hesap sahibi</p>
            </div>
            <button
              onClick={() => supabase().auth.signOut()}
              aria-label="Çıkış yap"
              title="Çıkış yap"
              className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-panel hover:text-danger"
            >
              <IconLogout className="size-[18px]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
