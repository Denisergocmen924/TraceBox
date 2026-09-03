/**
 * Metrics — kenar çubuğundaki "Metrics" bölümünün sayfası.
 *
 * Neden ayrı bir sayfa: grafik daha önce YALNIZCA cihaz detayında yaşıyordu,
 * yani "makinelerimin yükü nasıl" sorusuna bakmak için önce bir makine seçmek,
 * sonra logların ve künyenin arasından grafiği bulmak gerekiyordu. Overview'ın
 * küçük System Metrics kartı ise özet: 120 kova, tek çizgi kalınlığı, seçim
 * yok. Burası inceleme yeri — tam çözünürlük (§9.7'nin ~1000 kovası),
 * sürükleyerek yakınlaştırma (§9.8) ve iki ayrı eksen.
 *
 * İKİ GRAFİK: donanım (CPU/RAM/Disk, ortak yüzde ekseni) ve AĞ (gelen/giden).
 * Ağın ayrı olması bir tercih değil zorunluluk — yüzdenin tavanı var, ağın yok;
 * aynı eksene konsa biri diğerini ezerdi (lib/metrics.ts → networkTracks).
 *
 * Makine başına bir kart. Üst çubuktaki host seçicisi tek makineye kısıldığında
 * yalnızca o kalıyor, yani seçici burada da tüm sayfayı daraltıyor (§9.1'in
 * tek host/tek zaman kuralı).
 *
 * Burada log listesi YOK, künye YOK, aksiyon YOK: hepsinin kendi bölümü var.
 * Kullanıcının şikâyeti tam olarak buydu — her şeyin tek yerde yığılması.
 */
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import { deviceStatus, type Device } from "@/lib/devices";
import { PageHeader, Tally } from "@/components/PageHeader";
import { Timeline } from "@/components/Timeline";

/**
 * Aynı anda çizilecek en çok makine sayısı.
 *
 * Her kart kendi `metrics_buckets` çağrısını açıyor; sınırsız bırakmak, elli
 * makineli bir hesapta tek sayfa açılışında elli sorgu demek olurdu. Altı,
 * ekrana sığmayacak kadar çok ama tarayıcıyı zorlamayacak kadar az — üstü
 * kesiliyor ve KESİLDİĞİ YAZILIYOR, çünkü sessizce kısaltılmış bir liste
 * kullanıcıya makinelerinin bir kısmının veri göndermediğini düşündürürdü.
 */
const MAX_CHARTS = 6;

export default function MetricsPage() {
  const { devices, error, now, hostFilter } = useApp();

  const scoped = useMemo<Device[]>(() => {
    if (!devices) return [];
    return hostFilter ? devices.filter((d) => d.id === hostFilter) : devices;
  }, [devices, hostFilter]);

  const shown = scoped.slice(0, MAX_CHARTS);
  const hidden = scoped.length - shown.length;

  const scopeName =
    hostFilter && devices
      ? (devices.find((d) => d.id === hostFilter)?.device_name ?? null)
      : null;

  const online = scoped.filter((d) => deviceStatus(d, now) === "online").length;

  return (
    <div className="mx-auto max-w-[1248px]">
      <PageHeader
        title="Metrics"
        description="Full-resolution CPU, memory, disk and network history."
        scope={scopeName}
      >
        {devices && (
          <div className="flex divide-x divide-line">
            <Tally value={shown.length} label="Charted" />
            <Tally value={online} label="Online" tone="text-ok" />
          </div>
        )}
      </PageHeader>

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read hosts: {error}
        </p>
      )}

      {devices && scoped.length === 0 && (
        <p className="rounded-card border border-line bg-panel p-12 text-center text-sm text-muted shadow-card">
          {devices.length === 0 ? (
            <>
              No hosts yet. Add one from{" "}
              <Link href="/devices" className="font-medium text-accent">
                Hosts
              </Link>{" "}
              to start charting.
            </>
          ) : (
            "The selected host is not in this account any more."
          )}
        </p>
      )}

      <div className="space-y-6">
        {shown.map((device) => (
          <Timeline
            key={device.id}
            deviceId={device.id}
            ramTotalMb={device.ram_total_mb}
            heading={device.device_name}
            href={`/devices/${device.id}`}
            /* Çöküş şeridi burada kapalı: ekranda birden çok makine var ve her
               birine bir şerit + açılan süreç tablosu eklemek sayfayı asıl işi
               olan grafiklerden uzaklaştırırdı. Çöküş kayıtları cihazın kendi
               sayfasında, tam ayrıntısıyla duruyor (§9.4). */
            showCrashes={false}
          />
        ))}
      </div>

      {hidden > 0 && (
        <p className="mt-6 text-center text-sm text-muted">
          {hidden} more {hidden === 1 ? "host is" : "hosts are"} not charted
          here. Pick one from the host filter above to see it.
        </p>
      )}
    </div>
  );
}
