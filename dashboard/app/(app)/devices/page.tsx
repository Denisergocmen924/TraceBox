/**
 * Ekran 2 — Cihaz listesi (CLAUDE.md §9.3).
 *
 * Cevapladığı tek soru: "makinelerim iyi mi?"
 * İki panel bölünmesi YOK (sabit bağlam olmadığı için); kartlar ızgarada.
 *
 * Sayfa artık ne oturum kontrolü yapıyor ne de veri çekiyor: ikisi de kabukta
 * (app/(app)/layout.tsx + lib/appState.tsx). Sidebar aynı listeyi gösterdiği ve
 * toolbar aynı listeden uyarı türettiği için veri TEK yerde duruyor — üç ayrı
 * sorgu olsaydı üçü birbirinden birkaç saniye farklı bir "şu an"a bakardı.
 */
"use client";

import { useApp } from "@/lib/appState";
import { DeviceCard } from "./DeviceCard";
import { IconPlus, IconSearch } from "@/components/icons";

export default function DevicesPage() {
  const { devices, error, now, query } = useApp();

  const needle = query.trim().toLocaleLowerCase("tr");
  const shown = devices?.filter((d) =>
    d.device_name.toLocaleLowerCase("tr").includes(needle),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cihazlar</h1>
          <p className="mt-1 text-sm text-muted">
            Agent kurulu her makine ve son ölçümü.
          </p>
        </div>
        {/*
          "+ Cihaz Ekle" collector'a POST /devices atacak. Collector'da CORS
          middleware olmadığı için tarayıcıdan yapılan istek bugün bloklanıyor
          (§9.13) — buton bu yüzden devre dışı. Çalışmayan bir butonu canlı
          bırakmak, kullanıcıya sebebi görünmeyen bir hata göstermek olurdu.
        */}
        <button
          disabled
          title="Collector'a CORS eklenince açılacak (§9.13)"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconPlus className="size-4" />
          Cihaz Ekle
        </button>
      </header>

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Cihazlar okunamadı: {error}
        </p>
      )}

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
        <div className="rounded-card border border-dashed border-line bg-panel/50 p-12 text-center">
          <p className="font-medium">Henüz cihaz yok.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Bir cihaz eklendiğinde ve agent kurulduğunda burada görünür.
          </p>
        </div>
      )}

      {shown?.length === 0 && devices && devices.length > 0 && (
        <div className="rounded-card border border-dashed border-line bg-panel/50 p-12 text-center">
          <IconSearch className="mx-auto size-6 text-faint" />
          <p className="mt-3 text-sm text-muted">
            <span className="text-fg">{query}</span> ile eşleşen cihaz yok.
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
    </div>
  );
}
