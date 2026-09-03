/**
 * Özet kartları — referans 2'nin üst şeridi (CPU · Bellek · Disk · Ağ).
 *
 * Referanstaki dört kart birebir alındı; içeriği uydurulmadı. Her sayı,
 * hesabın cihazlarının EN SON ölçümlerinin ortalaması.
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
  formatBitratePair,
  formatPercent,
} from "@/lib/metrics";
import { IconCpu, IconDisk, IconMemory, IconNetwork } from "@/components/icons";

/** null'ları atarak ortalama; hiç sayı yoksa null. */
function mean(values: (number | null)[]): number | null {
  const numbers = values.filter((v): v is number => v != null);
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

const ICONS = {
  cpu: IconCpu,
  ram: IconMemory,
  disk: IconDisk,
} as const;

function Card({
  icon,
  chip,
  label,
  value,
  hint,
  bar,
  barTone,
}: {
  icon: React.ReactNode;
  chip: string;
  label: string;
  value: string;
  hint: string;
  /** 0–100; yoksa çubuk çizilmez (ağın yüzdesi olmaz). */
  bar: number | null;
  barTone: string;
}) {
  return (
    <div className="rounded-card border border-line bg-panel p-5 shadow-card">
      <div className="flex items-center gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${chip}`}>
          {icon}
        </span>
        <span className="text-sm font-medium text-muted">{label}</span>
      </div>

      <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>

      {bar != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${barTone}`}
            style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
          />
        </div>
      )}

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

  const netSent = mean(metrics.map((m) => m.net_sent_mb));
  const netRecv = mean(metrics.map((m) => m.net_recv_mb));
  // Birim büyüklüğe göre seçiliyor (Mbps / Kbps), o yüzden sayıyla birlikte
  // hesaplanıp alt satıra yazılıyor — bkz. formatBitratePair.
  const net =
    netSent == null || netRecv == null
      ? null
      : formatBitratePair(netSent, netRecv);

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {SERIES.map((series) => {
        const Icon = ICONS[series.key];
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
            icon={<Icon className="size-[18px]" />}
            chip={series.tone.chip}
            label={series.label}
            value={average == null ? "—" : formatPercent(average)}
            hint={hint}
            bar={average ?? 0}
            barTone={over ? "bg-danger" : series.tone.bar}
          />
        );
      })}

      <Card
        icon={<IconNetwork className="size-[18px]" />}
        chip="bg-net/10 text-net"
        label="Network"
        // Ağın tavanı yok: %90 dolu bir ağ kartı diye bir şey ölçmüyoruz.
        // Bu yüzden çubuk da yok, ok işaretleriyle yön veriliyor.
        value={net == null ? "—" : `↑${net.sent} ↓${net.recv}`}
        hint={net == null ? hint : `${hint} · ${net.unit}`}
        bar={null}
        barTone=""
      />
    </div>
  );
}
