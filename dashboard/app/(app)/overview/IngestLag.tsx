/**
 * Gecikme paneli — "ölçüm ile kayıt arasında ne kadar var?"
 *
 * TraceBox'ın vaadi "makine çökmeden ÖNCE veri dışarıda olsun" (CLAUDE.md §0).
 * Bu panel o vaadin ölçüsü: agent'ın damgaladığı `measured_at` ile sunucunun
 * damgaladığı `received_at` arasındaki fark. İkisi de zaten her satırda duruyor
 * (§5), yani ölçüm için ek bir şey saklanmıyor.
 *
 * Üç sayı birlikte gösteriliyor çünkü tek başına hiçbiri yeterli değil:
 * medyan tipik hâli, p95 kötü günü, en yüksek de en kötü anı anlatıyor. Yalnız
 * medyan gösterilseydi, on dakikalık tek bir tıkanma ekranda hiç görünmezdi —
 * §9.6 madde 6'nın grafik için koyduğu kuralın aynısı ("ortalama tek başına
 * yalan söyler") burada sayılara uygulanmış hâli.
 */
import { Panel, PanelNote } from "@/components/Panel";
import {
  formatLag,
  LAG_OK_MS,
  LAG_WARN_MS,
  type IngestLag as IngestLagData,
} from "@/lib/health";

function Figure({
  label,
  value,
  tone = "text-fg",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className={`text-xl leading-none font-semibold tabular-nums ${tone}`}>
        {value}
      </p>
      <p className="mt-1.5 text-xs text-faint">{label}</p>
    </div>
  );
}

export function IngestLagPanel({
  lag,
  loading,
}: {
  lag: IngestLagData | null;
  loading: boolean;
}) {
  return (
    <Panel
      title="Ingest lag"
      action={
        <span className="shrink-0 text-[13px] text-faint">measured → stored</span>
      }
    >
      {loading && !lag ? (
        <PanelNote>Measuring…</PanelNote>
      ) : !lag || lag.samples === 0 ? (
        <PanelNote>No rows to measure yet.</PanelNote>
      ) : (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-3 gap-3">
            <Figure
              label="Median"
              value={formatLag(lag.medianMs)}
              tone={
                lag.medianMs <= LAG_OK_MS
                  ? "text-ok"
                  : lag.medianMs <= LAG_WARN_MS
                    ? "text-warn"
                    : "text-danger"
              }
            />
            <Figure label="95th pct" value={formatLag(lag.p95Ms)} />
            <Figure label="Worst" value={formatLag(lag.maxMs)} />
          </div>

          <p className="mt-4 text-xs text-faint">
            Over the last {lag.samples} metric rows.
          </p>

          {/*
            Saat kayması gizlenmiyor. `received_at < measured_at` fiziksel
            olarak imkânsız — veri varmadan ölçülemez — ve görülüyorsa cihazın
            saati ileri demektir. O satırlar dağılımdan çıkarıldı; çıkarıldığını
            SÖYLEMESEYDİK ekrandaki gecikme olduğundan iyi görünürdü.
          */}
          {lag.skewed > 0 && (
            <p className="mt-2 text-xs text-warn">
              {lag.skewed} row{lag.skewed === 1 ? "" : "s"} arrived before they
              were measured — host clock is ahead. Excluded from the figures.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
