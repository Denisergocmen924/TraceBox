/**
 * Overview'ın başlık şeridi — dört rakam, altındaki dört panelin özeti.
 *
 * §9.11.2'de bu şerit CPU/RAM/Disk/Ağ ortalamalarına kilitlenmişti. Kullanıcı
 * 2026-08-31'de Overview'ın konusunu değiştirdi: ekran artık cihazların
 * ölçümlerini değil SİSTEMİN kendisini anlatıyor. O dört ortalama zaten
 * Metrics sayfasında ve cihaz kartlarında duruyordu; burada tekrar olurlardı.
 *
 * Referans 2'nin deseni korunuyor: üstte tek satırlık rakamlar, altında o
 * rakamı açan panel. Şerit "iyi mi?" sorusuna, paneller "neden?" sorusuna
 * cevap veriyor.
 *
 * Her kart HANGİ TEMELE dayandığını kendi altında yazıyor (§9.6 madde 5) —
 * "1.4 s" tek başına üç örnekten de beş yüz örnekten de çıkmış olabilir.
 */
import {
  coverageDays,
  formatLag,
  LAG_OK_MS,
  LAG_WARN_MS,
  type FlushEvents,
  type IngestLag,
  type RetentionState,
} from "@/lib/health";

type Tone = "ok" | "warn" | "danger" | "neutral";

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-faint",
};

const VALUE_TONE: Record<Tone, string> = {
  ok: "text-fg",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-fg",
};

function Stat({
  title,
  value,
  unit,
  note,
  tone,
}: {
  title: string;
  value: string;
  unit?: string;
  note: string;
  tone: Tone;
}) {
  return (
    <section className="rise bg-panel p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-xs font-medium text-muted">
        <span className={`size-1.5 rounded-full ${DOT[tone]}`} />
        {title}
      </h2>
      <p
        className={`mt-3 flex items-baseline gap-1.5 font-mono text-[28px] leading-none font-medium tracking-tight tabular-nums ${VALUE_TONE[tone]}`}
      >
        {value}
        {unit && <span className="font-sans text-xs font-normal text-muted">{unit}</span>}
      </p>
      <p className="mt-2 text-xs text-faint">{note}</p>
    </section>
  );
}

export function HealthStrip({
  reporting,
  hosts,
  lag,
  flushes,
  retention,
  now,
}: {
  reporting: number;
  hosts: number;
  lag: IngestLag | null;
  flushes: FlushEvents | null;
  retention: RetentionState | null;
  now: number;
}) {
  /*
   * Cihaz yokken rozet YEŞİL DEĞİL. "0 / 0 bildiriyor" teknik olarak doğru ama
   * hiçbir şey kanıtlamıyor; kurulumu hiç yapmamış kullanıcıya sistemin
   * çalıştığını söylemiş olurduk (lib/health.ts'teki `unknown` kuralı).
   */
  const hostTone: Tone =
    hosts === 0 ? "neutral" : reporting === hosts ? "ok" : reporting > 0 ? "warn" : "danger";

  const lagTone: Tone =
    !lag || lag.samples === 0
      ? "neutral"
      : lag.medianMs <= LAG_OK_MS
        ? "ok"
        : lag.medianMs <= LAG_WARN_MS
          ? "warn"
          : "danger";

  /*
   * Acil gönderim kartı hiçbir zaman KIRMIZI olmuyor. Flush bir arıza değil,
   * ürünün çalıştığının kanıtı: eşik aşıldığında veri çökmeden önce dışarı
   * taşındı demek. Kırmızı yakmak, sistemin doğru davranışını hata gibi
   * göstermek olurdu. Sıfır da bir haber değil — sakin bir makine.
   */
  const flushTone: Tone = flushes && flushes.total > 0 ? "warn" : "neutral";

  const covered = retention ? coverageDays(retention.oldestReceivedAt, now) : null;
  const retentionDays = retention?.retentionDays ?? null;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card xl:grid-cols-4">
      <Stat
        title="Reporting"
        value={hosts === 0 ? "—" : `${reporting} / ${hosts}`}
        note={hosts === 0 ? "No hosts registered" : "Hosts seen in the last minute"}
        tone={hostTone}
      />

      <Stat
        title="Ingest lag"
        value={lag && lag.samples > 0 ? formatLag(lag.medianMs) : "—"}
        note={
          lag && lag.samples > 0
            ? `Median over ${lag.samples} samples`
            : "No measurements yet"
        }
        tone={lagTone}
      />

      <Stat
        title="Emergency ships"
        value={flushes ? String(flushes.total) : "—"}
        note={flushes ? "Threshold crossings in range" : "No measurements yet"}
        tone={flushTone}
      />

      <Stat
        title="Recorded"
        value={covered == null ? "—" : covered.toFixed(1)}
        unit={covered == null ? undefined : `of ${retentionDays} days`}
        note={
          retention == null
            ? "No measurements yet"
            : `${retention.totalRows.toLocaleString("en-US")} rows retained`
        }
        tone="neutral"
      />
    </div>
  );
}
