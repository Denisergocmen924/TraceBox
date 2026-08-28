/**
 * Ekran 2 — Cihaz listesi (CLAUDE.md §9.3).
 *
 * Cevapladığı tek soru: "makinelerim iyi mi?"
 * İki panel bölünmesi YOK (sabit bağlam olmadığı için); kartlar ızgarada.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { fetchDevices, type Device } from "@/lib/devices";
import { DeviceCard } from "./DeviceCard";

/**
 * Liste 10 saniyede bir yenilenir — agent'ın komut poll'u ile aynı ritim.
 * Daha sık sormanın anlamı yok: last_seen zaten en fazla o kadar tazeleniyor.
 *
 * Burada Realtime KULLANILMIYOR. Realtime, son 24 saatin logları için
 * ayrıldı (§9.9); orada gecikme ürünün vaadinin parçası. Liste ekranında ise
 * "12 saniye önce" yazısının bir saniye geç güncellenmesi kimseyi ilgilendirmez,
 * buna karşılık her cihaz için ayrı bir abonelik açmak gerekirdi.
 */
const REFRESH_MS = 10_000;

export default function DevicesPage() {
  const { status, session } = useSession();
  const router = useRouter();

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Saniyede bir tikleyen "şu an". Kartlardaki "12 saniye önce" ve çevrimdışı
  // rozeti bunun üzerinden hesaplanır — veriyi yeniden çekmeye gerek kalmadan
  // sayaç ilerler.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  const load = useCallback(async () => {
    try {
      setDevices(await fetchDevices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (status !== "signedIn") return;
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [status, load]);

  if (status !== "signedIn") {
    return (
      <main className="grid min-h-screen place-items-center text-muted">
        Yükleniyor…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Cihazlar</h1>
          <p className="mt-1 truncate text-sm text-muted">
            {session.user.email}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            disabled
            title="Collector'a CORS eklenince açılacak (§9.13)"
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Cihaz Ekle
          </button>
          <button
            onClick={() => supabase().auth.signOut()}
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted transition hover:text-fg"
          >
            Çıkış yap
          </button>
        </div>
      </header>

      {error && (
        <p className="mb-6 rounded-xl border border-danger/40 bg-panel p-4 text-sm text-danger">
          Cihazlar okunamadı: {error}
        </p>
      )}

      {devices === null && !error && (
        <p className="text-sm text-muted">Yükleniyor…</p>
      )}

      {devices?.length === 0 && (
        <div className="rounded-xl border border-line bg-panel p-8 text-center">
          <p className="font-medium">Henüz cihaz yok.</p>
          <p className="mt-2 text-sm text-muted">
            Bir cihaz eklendiğinde ve agent kurulduğunda burada görünür.
          </p>
        </div>
      )}

      {devices && devices.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} now={now} />
          ))}
        </div>
      )}
    </main>
  );
}
