/**
 * Veri yolu — Overview'ın ana paneli.
 *
 * Bu ekranın konusu artık cihazın CPU'su değil, SİSTEMİN kendisi: veri
 * agent'tan çıkıp veritabanına düşüyor mu? Panel tam olarak bunu, yazma
 * yolunun dört durağını (CLAUDE.md §1) tek satırda gösteriyor.
 *
 * Renkler bir SAĞLIK UCUNDAN gelmiyor — ne agent'ın ne collector'ın dashboard'a
 * durum bildiren bir kanalı var; §9.1 gereği dashboard collector'a hiç istek
 * atmıyor. Her durağın hâli saklanmış bir kanıttan çıkarılıyor ve o kanıt
 * durağın altında yazılı duruyor (mantığı: lib/health.ts `dataPath`).
 *
 * Ok işaretinin rengi HEDEF durağın hâlini alıyor: kırık halka, kırılmanın
 * gerçekleştiği yerden itibaren renk değiştirsin. Sabit gri oklar, üç yeşil
 * bir kırmızı durağı bağlarken nerede koptuğunu göstermezdi.
 *
 * Filo şeridi de burada, ayrı bir panelde değil: yolun sol ucundaki Agent
 * durağının somut karşılığı o makineler. "2 / 3 bildiriyor" yazan bir durak,
 * hemen altında o üç makinenin adını göstermiyorsa yarım kalmış bir cümle.
 */
import { IconChart, IconCloud, IconDisk, IconServer } from "@/components/icons";
import { Panel } from "@/components/Panel";
import type { Device } from "@/lib/devices";
import type { Hop, HopState } from "@/lib/health";
import { FleetStrip } from "./FleetStrip";

const ICON: Record<Hop["key"], (p: { className?: string }) => React.ReactElement> = {
  agent: IconServer,
  collector: IconCloud,
  database: IconDisk,
  dashboard: IconChart,
};

/** Durağın ne yaptığı — panelin ikinci işi: mimariyi anlatmak. */
const ROLE: Record<Hop["key"], string> = {
  agent: "Collects and spools on the host",
  collector: "Authenticates the device key",
  database: "Stores rows behind RLS",
  dashboard: "Reads with your session",
};

/* Sınıf adları tam yazılı — Tailwind şablon ifadelerini tarayamaz. */
const DOT: Record<HopState, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  down: "bg-danger",
  unknown: "bg-faint",
};

const CHIP: Record<HopState, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  down: "bg-danger-soft text-danger",
  unknown: "bg-panel-2 text-faint",
};

const ARROW: Record<HopState, string> = {
  ok: "text-ok",
  warn: "text-warn",
  down: "text-danger",
  unknown: "text-faint",
};

function Arrow({ state }: { state: HopState }) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${ARROW[state]}`}
    >
      {/* Dikey ok dar ekranda, yatay ok geniş ekranda: duraklar da o kırılma
          noktasında sütundan satıra geçiyor. */}
      <svg
        viewBox="0 0 24 24"
        className="size-4 rotate-90 sm:rotate-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 12h14" strokeDasharray="3 3" />
        <path d="M14 7l5 5-5 5" />
      </svg>
    </div>
  );
}

function Stop({ hop }: { hop: Hop }) {
  const Icon = ICON[hop.key];

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3 rounded-card border border-line bg-panel-2 p-4">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${CHIP[hop.state]}`}
      >
        <Icon className="size-[18px]" />
      </span>

      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className={`size-1.5 shrink-0 rounded-full ${DOT[hop.state]}`} />
          {hop.label}
        </p>
        {/* Kanıt önce, rol sonra: kullanıcının aradığı "şu an ne oluyor",
            mimari bilgisi ise arka planda kalsın. */}
        <p className="mt-1 truncate text-xs text-muted">{hop.detail}</p>
        <p className="mt-0.5 truncate text-xs text-faint">{ROLE[hop.key]}</p>
      </div>
    </div>
  );
}

export function DataPath({
  hops,
  devices,
  now,
}: {
  hops: Hop[];
  devices: Device[];
  now: number;
}) {
  return (
    <Panel
      title="Data path"
      action={
        <span className="shrink-0 text-[13px] text-faint">
          Write path · device key → service key
        </span>
      }
    >
      <div className="px-5 pb-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
          {hops.map((hop, i) => (
            <div
              key={hop.key}
              className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <Stop hop={hop} />
              {i < hops.length - 1 && <Arrow state={hops[i + 1].state} />}
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <FleetStrip devices={devices} now={now} />
        </div>

        {/*
          Panelin dürüstlük cümlesi. Yeşil bir zincir gören kullanıcı, bunun
          bir sağlık ucundan değil saklanmış veriden çıkarıldığını bilmeli:
          collector ayakta ama hiç istek almıyor olabilir, bu panel bunu
          ayırt edemez ve edebiliyormuş gibi durmamalı.
        */}
        <p className="mt-4 text-xs text-faint">
          Inferred from stored evidence — last contact, arrival timestamps and
          this page&rsquo;s own queries. There is no health endpoint on the
          write path.
        </p>
      </div>
    </Panel>
  );
}
