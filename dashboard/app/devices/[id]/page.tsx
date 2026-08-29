/**
 * Ekran 3 — Cihaz detayı (CLAUDE.md §9.4).
 *
 * Cevapladığı soru: "bu makinede ne oldu?"
 *
 * Yerleşim 70/30: geniş sol panel inceleme alanı (çizelge + loglar), dar sağ
 * panel sabit bağlam ve aksiyonlar. Sağ panel kaydırmada yerinde kalır.
 */
"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { fetchDevice, type DeviceDetail } from "@/lib/devices";
import { RANGES, type RangeKey } from "@/lib/logs";
import { DetailPanel } from "./DetailPanel";
import { Timeline } from "./Timeline";
import { LogList } from "./LogList";

/** Künye yenileme — liste ekranıyla aynı ritim, agent'ın komut poll'ü. */
const REFRESH_MS = 10_000;

export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { status } = useSession();
  const router = useRouter();

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [range, setRange] = useState<RangeKey>("24h");

  /**
   * Aralığın sabitlendiği an. Saniyede bir tikleyen `now` kullanılsaydı
   * aralığın alt sınırı her saniye kayar, log listesi durmadan sıfırlanırdı.
   * Yalnızca aralık değiştiğinde tazelenir.
   */
  const [anchor, setAnchor] = useState(() => Date.now());

  const selectRange = useCallback((key: RangeKey) => {
    setRange(key);
    setAnchor(Date.now());
  }, []);

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  const load = useCallback(async () => {
    try {
      const row = await fetchDevice(id);
      if (row) setDevice(row);
      else setMissing(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

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

  const rangeSeconds =
    RANGES.find((r) => r.key === range)?.seconds ?? RANGES[0].seconds;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/devices" className="text-sm text-muted transition hover:text-fg">
        ← Cihazlar
      </Link>

      {error && (
        <p className="mt-6 rounded-xl border border-danger/40 bg-panel p-4 text-sm text-danger">
          Cihaz okunamadı: {error}
        </p>
      )}

      {/*
        "Bulunamadı" ile "senin değil" ayrı ayrı yazılmıyor: RLS başkasının
        cihazını da tam olarak bu şekilde gizliyor ve ikisini ayırmak, olmayan
        bir cihazın var olduğunu doğrulamak olurdu.
      */}
      {missing && (
        <div className="mt-6 rounded-xl border border-line bg-panel p-8 text-center">
          <p className="font-medium">Cihaz bulunamadı.</p>
          <p className="mt-2 text-sm text-muted">
            Silinmiş olabilir ya da bu hesaba ait olmayabilir.
          </p>
        </div>
      )}

      {!device && !missing && !error && (
        <p className="mt-6 text-sm text-muted">Yükleniyor…</p>
      )}

      {device && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[7fr_3fr]">
          <div className="min-w-0 space-y-6">
            <Timeline range={range} onRangeChange={selectRange} />
            <LogList
              deviceId={device.id}
              rangeSeconds={rangeSeconds}
              anchor={anchor}
              now={now}
            />
          </div>
          <DetailPanel device={device} now={now} />
        </div>
      )}
    </main>
  );
}
