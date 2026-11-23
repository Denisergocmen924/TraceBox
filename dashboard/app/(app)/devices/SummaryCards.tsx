/**
 * Özet kartları — üst şerit (CPU · Bellek · Disk).
 *
 * Her sayı, hesabın cihazlarının EN SON ölçümlerinin ortalaması.
 *
 * Ortalamaya YALNIZCA konuşan cihazlar giriyor. Sebep: çevrimdışı bir cihazın
 * son metriği saatler önceki bir andan kalma olabilir. Onu ortalamaya katmak,
 * "şu anda ortalama CPU %12" derken aslında dün geceden kalma bir sayıyı
 * karıştırmak olurdu. Kartın alt satırı kaç cihazın sayıldığını yazıyor —
 * seyreltilmiş grafiğin "her nokta = X" satırıyla aynı dürüstlük kuralı
 * (§9.6 madde 5): ekrandaki sayı, neyin ortalaması olduğunu kendisi söyler.
 */
"use client";

import {
  deviceStatus,
  type Device,
  type LatestMetric,
} from "@/lib/devices";
import {
  FLUSH_THRESHOLD,
  SERIES,
  formatPercent,
} from "@/lib/metrics";

/** null'ları atarak ortalama; hiç sayı yoksa null. */
function mean(values: (number | null)[]): number | null {
  const numbers = values.filter((v): v is number => v != null);
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}


function Card({
  chip,
  label,
  value,
  hint,
  bar,
  barTone,
}: {
  chip: string;
  label: string;
  value: string;
  hint: string;
  /** 0–100 yüzde; çubuğun doluluğu. */
  bar: number;
  barTone: string;
}) {
  return (
    <div className="rise bg-panel p-4 sm:p-5">
      <p className="flex items-center gap-2 text-xs font-medium text-muted">
        <span className={`size-1.5 rounded-full ${chip}`} />
        {label}
      </p>
      <p className="mt-3 font-mono text-[26px] leading-none font-medium tracking-tight tabular-nums">
        {value}
      </p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-2">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${barTone}`}
          style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-faint">{hint}</p>
    </div>
  );
}

export function SummaryCards({
  devices,
  now,
}: {
  devices: Device[];
  now: number;
}) {
  // "Konuşan" = çevrimdışı olmayan. Duraklatılmış cihaz da sayılıyor: pause
  // yalnızca göndermeyi durdurur, agent komut poll'una devam eder ve son
  // metriği tazedir (§7).
  const live = devices.filter((d) => deviceStatus(d, now) !== "offline");
  const metrics = live
    .map((d) => d.latest)
    .filter((m): m is LatestMetric => m != null);

  const hint =
    metrics.length === 0
      ? "No reporting hosts"
      : `Avg across ${metrics.length} hosts`;

  return (
    <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card sm:grid-cols-3">
      {SERIES.map((series) => {
        const average = mean(
          live.map((d) =>
            d.latest ? series.percent(d.latest, d.ram_total_mb) : null,
          ),
        );
        // Ortalama eşiği aşıyorsa çubuk kırmızı: tek bir cihazın değil,
        // hesabın tamamının sıkıştığı anlamına gelir ve bu daha ciddi.
        const over = average != null && average >= FLUSH_THRESHOLD[series.key];

        return (
          <Card
            key={series.key}
            chip={series.tone.bar}
            label={series.label}
            value={average == null ? "—" : formatPercent(average)}
            hint={hint}
            bar={average ?? 0}
            barTone={over ? "bg-danger" : series.tone.bar}
          />
        );
      })}
    </div>
  );
}
