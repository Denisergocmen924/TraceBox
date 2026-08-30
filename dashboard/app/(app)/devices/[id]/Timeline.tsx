/**
 * Zaman çizelgesi paneli (CLAUDE.md §9.5–§9.7).
 *
 * Üç ölçü ALT ALTA ve aynı x eksenini paylaşarak çizilir. Tek grafikte üst üste
 * bindirmek de, ölçü seçtiren bir düğme koymak da denenebilirdi; ikisi de aynı
 * soruyu cevapsız bırakırdı: "CPU fırladığında RAM ne yapıyordu?". Kara kutu
 * okuyan biri tam olarak bunu arıyor. Üst üste bindirilse üç bant birbirini
 * boyar, düğme konsa aynı anı üç kez ziyaret etmek gerekirdi.
 *
 * Üçü TEK istekle geliyor: metrics_buckets zaten üçünü birlikte döndürüyor.
 * Ayrı ayrı çekmek aynı satırları üç kez taratır ve üç grafik birbirinden
 * biraz farklı anlara ait olabilirdi.
 *
 * İmleç de ortak: bir grafiğin üstünde gezinirken üçünde birden aynı dikey
 * çizgi duruyor ve üçü aynı kovanın değerlerini yazıyor.
 *
 * Aralık düğmeleri burada DEĞİL, toolbar'da (§9.8: "zaman aralığı TEKTİR" —
 * aynı seçim log listesini de daraltıyor, o yüzden ikisinin ortağında durmalı).
 *
 * BU DİLİMDE YOK, bilerek:
 *   · Yakınlaştırma (§9.8) — alan seçme, geri, sıfırla. Ayrı dilim.
 *   · Çöküş işaretleri (§9.4) — gösterim biçimi henüz karara bağlanmadı (§9.13).
 *   · Canlı akış (§9.9) — aralık `anchor` ile sabitlenmiş durumda; Realtime
 *     dilimine kadar grafik yenilenmiyor. Log listesi de aynı şekilde çalışıyor,
 *     yani ekranın iki yarısı aynı ana bakıyor.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUCKET_COUNT,
  SERIES,
  bucketWidthMs,
  fetchBuckets,
  formatDuration,
  nearestIndex,
  type MetricBucket,
} from "@/lib/metrics";
import { axisTime } from "@/lib/time";
import { IconActivity } from "@/components/icons";
import { Chart } from "./Chart";

/** X ekseninde kaç etiket. Beşten fazlası dar ekranda üst üste biner. */
const TICKS = 5;

export function Timeline({
  deviceId,
  ramTotalMb,
  anchor,
  rangeSeconds,
}: {
  deviceId: string;
  /** RAM grafiğinin tavanı. Cihazın tamamı değil sadece bu alan gerekiyor:
      künye 10 saniyede bir yenilendiği için tüm nesneye bağlanmak, hiçbir şey
      değişmese bile grafiğin geometrisini yeniden hesaplatırdı. */
  ramTotalMb: number | null;
  /**
   * Aralığın sabitlendiği an — saniyede bir tikleyen "now" DEĞİL. O olsaydı
   * pencerenin iki ucu da her saniye kayar ve grafik durmadan yeniden çekilirdi.
   */
  anchor: number;
  rangeSeconds: number;
}) {
  const [buckets, setBuckets] = useState<MetricBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const toMs = anchor;
  const fromMs = anchor - rangeSeconds * 1000;
  const spanMs = toMs - fromMs;
  const widthMs = bucketWidthMs(fromMs, toMs, BUCKET_COUNT);

  /**
   * Uçuştaki bir istek, kullanıcı aralığı değiştirdikten sonra dönebilir.
   * Epoch olmadan 10 günlük yanıt, ekran çoktan 24 saate geçmişken grafiğe
   * yazılırdı — kullanıcı seçtiğinden başka bir aralığa bakıyor olurdu.
   */
  const epoch = useRef(0);

  useEffect(() => {
    epoch.current += 1;
    const mine = epoch.current;

    setLoading(true);
    setHoverTime(null);

    fetchBuckets({ deviceId, fromMs, toMs })
      .then((rows) => {
        if (mine !== epoch.current) return;
        setBuckets(rows);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine !== epoch.current) return;
        setBuckets([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (mine === epoch.current) setLoading(false);
      });
  }, [deviceId, fromMs, toMs]);

  const hoverIndex = useMemo(
    () => (hoverTime == null ? null : nearestIndex(buckets, hoverTime)),
    [hoverTime, buckets],
  );

  const onHoverTime = useCallback((t: number | null) => setHoverTime(t), []);

  const ticks = Array.from(
    { length: TICKS },
    (_, i) => fromMs + (spanMs * i) / (TICKS - 1),
  );

  const hovered = hoverIndex == null ? null : buckets[hoverIndex];

  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <IconActivity className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-medium">Zaman çizelgesi</h2>
          {/*
            §9.6 madde 5 — ZORUNLU. Seyreltilmiş bir grafik, seyreltildiğini
            söylemezse sessizce yalan söylemiş olur: kullanıcı ham veriye
            baktığını sanar. Başlığın hemen altında, çünkü okunması grafiğe
            bakmadan ÖNCE gerekiyor.
          */}
          <p className="mt-0.5 text-xs text-faint">
            Her nokta = {formatDuration(widthMs)} · bant en düşük–en yüksek,
            çizgi ortalama
          </p>
        </div>
        {hovered && (
          <p className="ml-auto shrink-0 text-right text-xs tabular-nums">
            <span className="text-fg">
              {axisTime(Date.parse(hovered.bucket_start), spanMs)}
            </span>
            <span className="block text-faint">{hovered.samples} ölçüm</span>
          </p>
        )}
      </header>

      {error && (
        <p className="px-5 py-12 text-center text-sm text-danger">
          Grafik okunamadı: {error}
        </p>
      )}

      {!error && loading && buckets.length === 0 && (
        <div className="space-y-6 p-5">
          {SERIES.map((s) => (
            <div
              key={s.key}
              className="h-24 animate-pulse rounded-lg bg-panel-2"
            />
          ))}
        </div>
      )}

      {!error && !loading && buckets.length === 0 && (
        <p className="px-5 py-16 text-center text-sm text-muted">
          Bu aralıkta ölçüm yok.
        </p>
      )}

      {!error && buckets.length > 0 && (
        <>
          <div className="divide-y divide-line/60">
            {SERIES.map((series) => (
              <Chart
                key={series.key}
                series={series}
                buckets={buckets}
                ramTotalMb={ramTotalMb}
                fromMs={fromMs}
                toMs={toMs}
                widthMs={widthMs}
                hoverIndex={hoverIndex}
                onHoverTime={onHoverTime}
              />
            ))}
          </div>

          <div className="flex justify-between border-t border-line bg-bg-soft/40 px-5 py-2 text-[11px] tabular-nums text-faint">
            {ticks.map((t) => (
              <span key={t}>{axisTime(t, spanMs)}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
