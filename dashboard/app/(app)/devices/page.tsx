/**
 * Ekran 2 — Hosts (CLAUDE.md §9.3).
 *
 * Cevapladığı tek soru: "makinelerim iyi mi?"
 *
 * Yerleşim referans 2'den: başlık + sağda özet sayılar, altında dört ölçü
 * kartı, en altta cihazların kendisi. Sıra kabaca soruların sırası — "her şey
 * yolunda mı" → "hangi ölçü sıkışmış" → "hangi makine".
 *
 * Sayfa ne oturum kontrolü yapıyor ne de veri çekiyor: ikisi de kabukta
 * (app/(app)/layout.tsx + lib/appState.tsx). Sidebar aynı listeyi gösterdiği ve
 * toolbar aynı listeden uyarı türettiği için veri TEK yerde duruyor — üç ayrı
 * sorgu olsaydı üçü birbirinden birkaç saniye farklı bir "şu an"a bakardı.
 */
"use client";

import { useState } from "react";
import { useApp } from "@/lib/appState";
import { deviceStatus } from "@/lib/devices";
import { AddHostDialog } from "./AddHostDialog";
import { DeviceCard } from "./DeviceCard";
import { SummaryCards } from "./SummaryCards";
import { IconPlus } from "@/components/icons";

/** Başlığın sağındaki üçlü sayaç (referans 2: Hosts / Online / Offline). */
function Tally({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="px-5 text-center">
      <p className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </p>
      <p className={`mt-0.5 text-xs ${tone ?? "text-muted"}`}>{label}</p>
    </div>
  );
}

export default function DevicesPage() {
  const { devices, error, now, hostFilter, reload } = useApp();
  const [adding, setAdding] = useState(false);

  /*
   * Üst çubuktaki host seçicisi burayı da daraltıyor (bir arama kutusunun
   * yerini aldı, bkz. lib/appState.tsx). Seçili cihaz listeden silinmişse
   * süzgeç hiçbir şey bırakmaz; o durumda tüm liste gösteriliyor — kullanıcıyı
   * sebebi görünmeyen boş bir ekranla baş başa bırakmamak için.
   */
  const filtered = hostFilter
    ? devices?.filter((d) => d.id === hostFilter)
    : devices;
  const shown = filtered?.length ? filtered : devices;

  const online =
    devices?.filter((d) => deviceStatus(d, now) === "online").length ?? 0;
  const offline =
    devices?.filter((d) => deviceStatus(d, now) === "offline").length ?? 0;

  return (
    <div className="mx-auto max-w-[1248px]">
      {/* --- başlık + özet sayaçlar -------------------------------------- */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
            Hosts
          </h1>
          <p className="mt-1 text-sm text-muted">
            Every machine running the agent, and its latest sample.
          </p>
        </div>

        {devices && (
          <div className="flex divide-x divide-line">
            <Tally value={devices.length} label="Hosts" />
            <Tally value={online} label="Online" tone="text-ok" />
            <Tally value={offline} label="Offline" tone="text-danger" />
          </div>
        )}
      </header>

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read hosts: {error}
        </p>
      )}

      {devices && devices.length > 0 && (
        <SummaryCards devices={devices} now={now} />
      )}

      {/* --- liste başlığı ----------------------------------------------- */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-[0.08em] text-faint">
          MACHINES
        </h2>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-accent-strong"
        >
          <IconPlus className="size-4" />
          Add Host
        </button>
      </div>

      {devices === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* İskelet: boş ekran yerine kartın alacağı yer baştan ayrılıyor,
              böylece veri gelince yerleşim zıplamıyor. */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-card border border-line bg-panel"
            />
          ))}
        </div>
      )}

      {devices?.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-panel/60 p-12 text-center">
          <p className="font-medium">No hosts yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Add a host, install the agent on that machine, and it will show up
            here.
          </p>
        </div>
      )}

      {shown && shown.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((device) => (
            <DeviceCard key={device.id} device={device} now={now} />
          ))}
        </div>
      )}

      {adding && (
        <AddHostDialog onClose={() => setAdding(false)} onCreated={reload} />
      )}
    </div>
  );
}
