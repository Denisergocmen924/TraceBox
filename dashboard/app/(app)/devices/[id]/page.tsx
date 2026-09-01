/**
 * Ekran 3 — Cihaz detayı (CLAUDE.md §9.4).
 *
 * Cevapladığı soru: "bu makinede ne oldu?"
 *
 * Yerleşim 70/30: geniş sol panel inceleme alanı (çizelge + loglar), dar sağ
 * panel sabit bağlam ve aksiyonlar. Sağ panel kaydırmada yerinde kalır.
 *
 * Aralık (24 saat … 10 gün) burada DEĞİL, toolbar'da seçiliyor; grafikte
 * sürükleyerek yapılan ince ayar da (§9.8) aynı yerde. §9.8: "zaman aralığı
 * TEKTİR" — aynı pencere hem grafiği hem log listesini daraltıyor, dolayısıyla
 * ikisinin ortak bir üstünde (appState) durması gerekiyordu. Bu sayfa pencereyi
 * ne tutuyor ne de aşağı taşıyor; iki bileşen de doğrudan oradan okuyor.
 */
"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import { fetchDevice, type DeviceDetail } from "@/lib/devices";
import { errorMessage } from "@/lib/errors";
import { IconChevron } from "@/components/icons";
import { DetailPanel } from "./DetailPanel";
import { Timeline } from "@/components/Timeline";
import { LogList } from "@/components/LogList";

/** Künye yenileme — liste ekranıyla aynı ritim, agent'ın komut poll'ü. */
const REFRESH_MS = 10_000;

export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { now } = useApp();

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const row = await fetchDevice(id);
      if (row) setDevice(row);
      else setMissing(true);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => clearInterval(refresh);
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl">
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/devices" className="transition hover:text-fg">
          Hosts
        </Link>
        <IconChevron className="size-3.5 text-faint" />
        <span className="truncate text-fg">
          {device?.device_name ?? "…"}
        </span>
      </nav>

      {error && (
        <p className="rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not load the host: {error}
        </p>
      )}

      {/*
        "Bulunamadı" ile "senin değil" ayrı ayrı yazılmıyor: RLS başkasının
        cihazını da tam olarak bu şekilde gizliyor ve ikisini ayırmak, olmayan
        bir cihazın var olduğunu doğrulamak olurdu.
      */}
      {missing && (
        <div className="rounded-card border border-dashed border-line bg-panel/50 p-12 text-center">
          <p className="font-medium">Host not found.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            It may have been deleted, or it may not belong to this account.
          </p>
        </div>
      )}

      {!device && !missing && !error && (
        <div className="grid gap-5 lg:grid-cols-[7fr_3fr]">
          <div className="h-96 animate-pulse rounded-card border border-line bg-panel" />
          <div className="h-96 animate-pulse rounded-card border border-line bg-panel" />
        </div>
      )}

      {device && (
        <div className="grid items-start gap-5 lg:grid-cols-[7fr_3fr]">
          <div className="min-w-0 space-y-5">
            <Timeline
              deviceId={device.id}
              ramTotalMb={device.ram_total_mb}
            />
            <LogList deviceId={device.id} />
          </div>
          <DetailPanel device={device} now={now} onChanged={load} />
        </div>
      )}
    </div>
  );
}
