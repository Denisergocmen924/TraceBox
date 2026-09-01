/**
 * Ekran 0 — Overview: "kara kutu kayıt yapıyor mu?"
 *
 * Bu sayfa 2026-08-31'de KONU DEĞİŞTİRDİ. Önceki hâli referans 2'nin birebir
 * kopyasıydı: KPI şeridi, sistem metrikleri grafiği, son loglar, host tablosu,
 * uyarılar, en yoğun makineler. Kullanıcının itirazı iki katmanlıydı — ekran
 * kaydırılmadan bitmiyordu ve gösterdiği her şeyin zaten kendi sayfası vardı
 * (Metrics, Logs, Hosts, Alerts). Yani Overview bir özet değil, dört sayfanın
 * kısaltılmış tekrarıydı.
 *
 * Yeni konu: cihazların ölçümleri değil SİSTEMİN kendisi. Beş bölüm, kullanıcı
 * tarafından seçildi — veri yolu · gecikme · acil gönderimler · saklama ·
 * filo şeridi. Hiçbiri başka sayfada yok, hepsi tek soruyu cevaplıyor.
 *
 * Bunun bir sonucu: §9.11.2'nin "KPI şeridi CPU/RAM/Disk/Ağ ortalamalarıdır"
 * kilidi bu sayfada geçersiz. Şerit hâlâ orada, ama artık boru hattını
 * ölçüyor (HealthStrip).
 *
 * Yerleşim tek ekrana sığacak biçimde kuruldu: başlık → dört rakam → veri yolu
 * (filo şeridi onun alt bandında) → üç panel. Kaydırma gerektiren bir "özet"
 * ekranı kendi işini yapmıyor demektir; bu yüzden filo kendi paneline değil
 * veri yolunun içine kondu ve acil gönderim listesi dört satırla sınırlandı.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/appState";
import { deviceStatus, type Device } from "@/lib/devices";
import {
  dataPath,
  fetchFlushEvents,
  fetchIngestLag,
  fetchRetention,
  type FlushEvents,
  type IngestLag,
  type RetentionState,
} from "@/lib/health";
import { DataPath } from "./DataPath";
import { FlushEventsPanel } from "./FlushEvents";
import { HealthStrip } from "./HealthStrip";
import { IngestLagPanel } from "./IngestLag";
import { RetentionPanel } from "./Retention";

export default function OverviewPage() {
  const { devices, error, now, hostFilter, timeWindow, reloadNonce } = useApp();

  const [lag, setLag] = useState<IngestLag | null>(null);
  const [retention, setRetention] = useState<RetentionState | null>(null);
  const [flushes, setFlushes] = useState<FlushEvents | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [loadingFlushes, setLoadingFlushes] = useState(true);

  /** Üst çubuktaki seçici tüm sayfayı daraltıyor (§9.1'in tek host kuralı). */
  const scoped = useMemo<Device[]>(() => {
    if (!devices) return [];
    return hostFilter ? devices.filter((d) => d.id === hostFilter) : devices;
  }, [devices, hostFilter]);

  const { from, to } = timeWindow;

  /*
   * İKİ ayrı effect, çünkü bağımlılıkları farklı.
   *
   * Gecikme ve saklama zaman penceresine BAKMIYOR: ikisi de "şu an sistem ne
   * hâlde" sorusunu cevaplıyor, kullanıcının incelediği aralığı değil. Üstelik
   * saklama sorgusu üç tabloda `count: exact` çalıştırıyor — kullanıcı her
   * aralık düğmesine bastığında yeniden saymak, hiçbir şeyi değiştirmeyen
   * pahalı bir tarama olurdu.
   */
  useEffect(() => {
    let alive = true;
    setLoadingState(true);

    Promise.all([
      fetchIngestLag({ deviceId: hostFilter }),
      fetchRetention({ deviceId: hostFilter }),
    ])
      .then(([nextLag, nextRetention]) => {
        if (!alive) return;
        setLag(nextLag);
        setRetention(nextRetention);
      })
      .catch(() => {
        // Sessiz düşüş: hata bandı zaten cihaz sorgusunun hatasını gösteriyor
        // ve aynı RLS'in altında koşan bu sorgular ondan bağımsız bozulmaz.
        if (alive) {
          setLag(null);
          setRetention(null);
        }
      })
      .finally(() => {
        if (alive) setLoadingState(false);
      });

    return () => {
      alive = false;
    };
  }, [hostFilter, reloadNonce]);

  useEffect(() => {
    let alive = true;
    setLoadingFlushes(true);

    fetchFlushEvents({ deviceId: hostFilter, fromMs: from, toMs: to })
      .then((next) => {
        if (alive) setFlushes(next);
      })
      .catch(() => {
        if (alive) setFlushes(null);
      })
      .finally(() => {
        if (alive) setLoadingFlushes(false);
      });

    return () => {
      alive = false;
    };
  }, [hostFilter, from, to, reloadNonce]);

  const deviceNames = useMemo(
    () => new Map((devices ?? []).map((d) => [d.id, d.device_name])),
    [devices],
  );

  /*
   * "Bildiriyor" ölçütü çevrimdışı OLMAMAK, çevrimiçi olmak değil.
   * Duraklatılmış bir cihaz veri göndermez ama komut poll'ünü sürdürür (§7),
   * yani boru hattı onun için de ayakta. Silinme bekleyen cihaz da öyle.
   */
  const reporting = scoped.filter(
    (d) => deviceStatus(d, now) !== "offline",
  ).length;

  const hops = useMemo(
    () =>
      dataPath({
        devices: devices == null ? null : scoped,
        now,
        error,
        lastReceivedAt: lag?.lastReceivedAt ?? null,
      }),
    [devices, scoped, now, error, lag],
  );

  return (
    <div className="mx-auto max-w-[1248px]">
      <header className="mb-6">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
          Overview
        </h1>
        <p className="mt-1 text-sm text-muted">
          How the recorder is doing — from the host all the way to this page.
        </p>
      </header>

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read hosts: {error}
        </p>
      )}

      <div className="space-y-6">
        <HealthStrip
          reporting={reporting}
          hosts={scoped.length}
          lag={lag}
          flushes={flushes}
          retention={retention}
          now={now}
        />

        <DataPath hops={hops} devices={scoped} now={now} />

        <div className="grid items-start gap-6 xl:grid-cols-3">
          <IngestLagPanel lag={lag} loading={loadingState} />
          <FlushEventsPanel
            flushes={flushes}
            deviceNames={deviceNames}
            now={now}
            loading={loadingFlushes}
          />
          <RetentionPanel
            retention={retention}
            now={now}
            loading={loadingState}
          />
        </div>
      </div>
    </div>
  );
}
