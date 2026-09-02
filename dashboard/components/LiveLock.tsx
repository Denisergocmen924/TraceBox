/**
 * Kilit düğmesi + "Live" rozeti — canlı akışın (§9.9) TEK görünen yüzü.
 *
 * İkisi tek bileşende, çünkü aynı şeyin iki yarısı: rozet kanalın gerçekten
 * kurulu olduğunu söylüyor (§9.6 madde 5), düğme akışın durdurulup
 * durdurulmadığını. Ayrı ayrı yerleştirilselerdi bir panelde rozet, ötekinde
 * düğme kalabilir ve kullanıcı "Live" yazan ama ilerlemeyen bir ekranın
 * sebebini hiçbir yerde göremezdi.
 *
 * Kilit PAYLAŞILAN bir bayrak (lib/appState.tsx): buradaki düğme yalnızca
 * yanındaki paneli değil, sayfadaki grafiği ve log listesini birlikte
 * donduruyor — §9.8 "zaman aralığı TEKTİR" kuralının gereği. Bu yüzden hangi
 * kopyasına basıldığının bir önemi yok, hepsi aynı anahtarı çeviriyor.
 *
 * Üst çubukta DEĞİL, panelin başlığında: kilit soyut bir tercih değil, tam da
 * o an bakılan grafiğin ilerleyip ilerlemediği. Kararın verildiği yer ile
 * sonucunun görüldüğü yer arasında göz gezdirmek gerekmemeli.
 */
"use client";

import { useApp } from "@/lib/appState";
import { IconLock, IconLockOpen } from "./icons";

export function LiveLock({ connected }: { connected: boolean }) {
  const { locked, toggleLock } = useApp();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={toggleLock}
        aria-pressed={locked}
        aria-label={locked ? "Unlock and follow live data" : "Lock the current view"}
        title={
          locked
            ? "Locked: the view is frozen. Click to follow live data again."
            : "Live: the view follows new data. Click to freeze it."
        }
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
          locked
            ? "border-accent/50 bg-accent-soft text-accent"
            : "border-line bg-panel text-muted hover:text-fg"
        }`}
      >
        {locked ? (
          <IconLock className="size-3.5 shrink-0" />
        ) : (
          <IconLockOpen className="size-3.5 shrink-0" />
        )}
        {locked ? "Locked" : "Lock"}
      </button>

      {/*
        Rozet yalnızca kanal GERÇEKTEN kuruluyken yanıyor. "Live" yazıp satır
        akıtmamak, kullanıcıya hiç veri üretilmediğini söylemek olurdu — oysa
        bağlantı kopmuş olabilir. Kilitliyken de sönük: orada kenar zaten
        ilerlemiyor ve sebebini yanındaki düğme söylüyor.
      */}
      {connected && (
        <span className="flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-[11px] font-semibold text-ok">
          <span className="size-1.5 animate-pulse rounded-full bg-ok" />
          Live
        </span>
      )}
    </div>
  );
}
