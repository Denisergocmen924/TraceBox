/**
 * Acil gönderimler — ürünün asıl iddiasının kanıt panosu.
 *
 * Agent bir eşiği aştığında (cpu>90, ram>90, disk>95 ya da error/critical bir
 * log — §7 `flush.py`) sıradaki gönderim turunu BEKLEMEZ, spool'u anında
 * boşaltır ve o anın süreç fotoğrafını `crash_snapshots`'a yazar. Buradaki her
 * satır, verinin çökmeden önce dışarı taşındığı bir andır.
 *
 * Sayaç neden `crash_snapshots`: flush her tetiklendiğinde bir satır oluşuyor,
 * `crash_processes` eklentisi kapalı olsa bile — eklenti yalnızca `processes`
 * dizisini dolduruyor. Yani satır sayısı olayın kendisini sayıyor.
 *
 * Panel hiçbir zaman ALARM RENGİNDE değil. Flush bir arıza değil, sistemin
 * doğru davranışı; kırmızı yakmak çalışan bir mekanizmayı hata gibi
 * göstermek olurdu.
 */
import Link from "next/link";
import { Panel, PanelNote } from "@/components/Panel";
import { relativeTime } from "@/lib/time";
import type { FlushEvents as FlushData } from "@/lib/health";

/**
 * Tetikleyici adları agent'tan geldiği gibi geliyor (§4.2: cpu | ram | disk |
 * log). Renkler ölçü kimlikleriyle aynı — kullanıcı zaten CPU'yu mor, RAM'i
 * yeşil, diski turuncu olarak öğrendi; burada başka renk kullanmak aynı şeye
 * ikinci bir kimlik vermek olurdu.
 */
const REASON: Record<string, { label: string; chip: string }> = {
  cpu: { label: "CPU", chip: "bg-cpu-soft text-cpu" },
  ram: { label: "RAM", chip: "bg-ram-soft text-ram" },
  disk: { label: "Disk", chip: "bg-disk-soft text-disk" },
  log: { label: "Log", chip: "bg-danger-soft text-danger" },
  unknown: { label: "Unknown", chip: "bg-panel-2 text-faint" },
};

function reasonOf(key: string) {
  return REASON[key] ?? REASON.unknown;
}

export function FlushEventsPanel({
  flushes,
  deviceNames,
  now,
  loading,
}: {
  flushes: FlushData | null;
  deviceNames: Map<string, string>;
  now: number;
  loading: boolean;
}) {
  return (
    <Panel
      title="Emergency ships"
      action={
        <span className="shrink-0 text-[13px] text-faint">threshold crossed</span>
      }
    >
      {loading && !flushes ? (
        <PanelNote>Loading…</PanelNote>
      ) : !flushes || flushes.total === 0 ? (
        <PanelNote>
          No thresholds crossed in this range — nothing needed an early ship.
        </PanelNote>
      ) : (
        <div className="px-5 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(flushes.byReason)
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => {
                const reason = reasonOf(key);
                return (
                  <span
                    key={key}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${reason.chip}`}
                  >
                    {reason.label} · {count}
                  </span>
                );
              })}
          </div>

          <ul className="mt-3">
            {flushes.recent.map((event) => (
              <li
                key={event.id}
                className="flex items-baseline gap-3 border-t border-line py-1.5 text-sm first:border-t-0"
              >
                <span className="w-14 shrink-0 text-xs font-medium text-muted">
                  {reasonOf(event.trigger_reason ?? "unknown").label}
                </span>
                {/*
                  Cihaz adı bağlantı: kullanıcının bir sonraki adımı zaten
                  "o an o makinede ne oldu" — detay ekranı grafiği ve logları
                  aynı pencereye kısıyor (§9.8).
                */}
                <Link
                  href={`/devices/${event.device_id}`}
                  className="min-w-0 flex-1 truncate transition hover:text-accent"
                >
                  {deviceNames.get(event.device_id) ?? "Unknown host"}
                </Link>
                <span className="shrink-0 text-xs text-faint tabular-nums">
                  {relativeTime(event.measured_at, now)}
                </span>
              </li>
            ))}
          </ul>

          {/*
            Rozetler İNDİRİLEN satırlardan sayılıyor, penceredeki hepsinden
            değil (lib/health.ts). Toplam daha büyükse bunu söylemek zorundayız;
            yoksa dağılım bütünün oranıymış gibi okunurdu (§9.6 madde 5).
          */}
          {flushes.total > flushes.recent.length && (
            <p className="mt-3 text-xs text-faint">
              Showing the {flushes.recent.length} most recent of {flushes.total}.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
