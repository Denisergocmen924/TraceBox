/**
 * Çöküş işaretleri şeridi (CLAUDE.md §9.4).
 *
 * *"Çöküş anları grafiğin üstünde işaret olarak durur; tıklanınca o anın süreç
 * listesi açılır. Projenin asıl iddiası ekranda tam burada görünür olur."*
 *
 * Neden TEK BİR ŞERİT, üç grafiğin üstüne serpiştirilmiş işaretler değil:
 * çöküş anı tek bir zamandır, üç ölçüye ait üç ayrı olay değil. Her grafiğe
 * kopyalansaydı ekranda üç kat işaret olur ve kullanıcı üçünün aynı ana ait
 * olduğunu gözüyle eşleştirmek zorunda kalırdı. Şerit x eksenini grafiklerle
 * paylaşıyor (aynı yatay iç boşluk, aynı `fromMs/toMs`), yani bir işaret ile
 * onun altındaki sıçrama aynı dikey hizada duruyor.
 *
 * Şerit, kayıt olmasa BİLE duruyor. İşaretler ancak bir çöküş yaşandığında
 * belirdiği için, şerit yokken kullanıcı böyle bir yeteneğin varlığından hiç
 * haberdar olmazdı; boş hâlde ne beklemesi gerektiğini yazıyor.
 *
 * Seçili kaydın ayrıntısı şeridin ALTINDA, üste açılan bir kutu olarak değil:
 * kutu, altındaki grafiği tam da karşılaştırılması gereken anda örterdi.
 */
"use client";

import { useEffect, useState } from "react";
import {
  triggerStyle,
  type CrashProcess,
  type CrashSnapshot,
} from "@/lib/crashes";
import { localDateTime } from "@/lib/time";
import { IconAlert, IconClose } from "@/components/icons";

/** Süreç satırı — ad solda, iki sayı sağa dayalı ve tabular. */
function ProcessRow({ process }: { process: CrashProcess }) {
  return (
    <tr className="border-t border-line">
      <td className="max-w-0 py-1.5 pr-3">
        <span className="block truncate font-medium" title={process.name}>
          {process.name}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-muted">
        {process.cpu == null ? "—" : `${process.cpu.toFixed(1)}%`}
      </td>
      <td className="py-1.5 text-right tabular-nums text-muted">
        {process.ram_mb == null ? "—" : `${Math.round(process.ram_mb)} MB`}
      </td>
    </tr>
  );
}

export function CrashMarkers({
  snapshots,
  truncated,
  loading,
  fromMs,
  toMs,
}: {
  snapshots: CrashSnapshot[];
  truncated: boolean;
  loading: boolean;
  fromMs: number;
  toMs: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const spanMs = Math.max(toMs - fromMs, 1);

  /*
   * Pencere değişince seçim düşer. Düşmeseydi kullanıcı başka bir aralığa
   * geçtikten sonra, artık ekranda görünmeyen bir ana ait süreç listesine
   * bakmaya devam ederdi.
   */
  useEffect(() => setSelectedId(null), [fromMs, toMs]);

  const selected = snapshots.find((s) => s.id === selectedId) ?? null;
  const style = selected ? triggerStyle(selected.trigger_reason) : null;

  return (
    <div className="border-b border-line bg-bg-soft">
      {/* --- başlık satırı ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint">
          <IconAlert className="size-3.5" />
          CRASH SNAPSHOTS
        </span>
        <span className="min-w-0 text-[11px] text-faint">
          {loading
            ? "Loading…"
            : snapshots.length === 0
              ? "None in this range — the agent captures one when a threshold is crossed."
              : truncated
                ? // §9.6 madde 5'in dürüstlük kuralı: kırpıldıysa söylenir.
                  `Showing the ${snapshots.length} most recent in this range.`
                : `${snapshots.length} in this range · click a marker`}
        </span>
      </div>

      {/* --- işaret şeridi ------------------------------------------------ */}
      <div className="relative mx-5 mt-1.5 mb-3 h-5">
        {/* İşaretlerin üzerinde durduğu eksen; boşken de şeridi görünür kılar. */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-line" />

        {snapshots.map((snapshot) => {
          const fraction = (Date.parse(snapshot.measured_at) - fromMs) / spanMs;
          /*
           * Pencere dışına düşen kayıt çizilmez: sorgunun aralığı ile ekranın
           * aralığı yakınlaştırma sırasında bir kare boyunca ayrışabiliyor
           * (yeni veri gelene kadar eski dizi ekranda kalıyor).
           */
          if (fraction < 0 || fraction > 1) return null;

          const marker = triggerStyle(snapshot.trigger_reason);
          const active = snapshot.id === selectedId;

          return (
            <button
              key={snapshot.id}
              onClick={() => setSelectedId(active ? null : snapshot.id)}
              title={`${marker.label} · ${localDateTime(snapshot.measured_at)}`}
              aria-label={`Crash snapshot at ${localDateTime(snapshot.measured_at)}`}
              aria-pressed={active}
              /* Tıklama hedefi işaretin kendisinden geniş: üçgen 10px, hedef
                 20px. Bir sıçramanın tam üstündeki 10 pikseli fareyle
                 tutturmak zorlaşırdı. */
              className={`absolute bottom-0 flex w-5 -translate-x-1/2 justify-center pt-1 ${marker.text}`}
              style={{ left: `${fraction * 100}%` }}
            >
              {/*
                Aşağı bakan üçgen: ucu tam olarak olayın anını gösteriyor. Bir
                nokta olsaydı hangi anı işaret ettiği yarıçapı kadar belirsiz
                kalırdı. Rengi butondan (`currentColor`) miras alıyor.
              */}
              <span
                className={`block size-0 border-x-[5px] border-x-transparent border-t-[9px] border-t-current transition ${
                  active ? "scale-125" : "opacity-70 hover:opacity-100"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* --- seçili kaydın süreç listesi ---------------------------------- */}
      {selected && style && (
        <div className="border-t border-line bg-panel px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}
            >
              {style.label}
            </span>
            <p className="text-sm font-medium tabular-nums">
              {localDateTime(selected.measured_at)}
            </p>
            <button
              onClick={() => setSelectedId(null)}
              aria-label="Close snapshot"
              className="ml-auto rounded-md p-1 text-muted transition hover:bg-panel-2 hover:text-fg"
            >
              <IconClose className="size-4" />
            </button>
          </div>

          {selected.processes.length === 0 ? (
            /*
              Boş liste bir HATA DEĞİL: `crash_processes` eklentisi kapalıyken
              agent süreçleri hiç toplamıyor (§7). Kaydın kendisi yine gerçek —
              o anda bir eşiğin aşıldığını söylüyor. Bunu yazmazsak kullanıcı
              veri kaybettiğini sanar.
            */
            <p className="mt-3 text-sm text-muted">
              No process list in this snapshot. Enable the{" "}
              <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-xs">
                crash_processes
              </code>{" "}
              add-on on this host to capture the top consumers.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[320px] table-fixed text-xs">
                <thead className="text-faint">
                  <tr>
                    <th className="pb-1 text-left font-medium">Process</th>
                    <th className="w-20 pb-1 text-right font-medium">CPU</th>
                    <th className="w-24 pb-1 text-right font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.processes.map((process, i) => (
                    <ProcessRow key={`${process.name}-${i}`} process={process} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
