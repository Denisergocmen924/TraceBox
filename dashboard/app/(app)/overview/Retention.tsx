/**
 * Saklama penceresi — "kara kutu ne kadar geriye gidiyor?"
 *
 * `accounts.retention_days` bir POLICY: kullanıcı değiştiremez (§5). Her gece
 * 00:00 UTC'de pg_cron, penceresi dolmuş satırları siliyor (`retention.sql`).
 * Panel bu pencerenin ne kadarının DOLU olduğunu gösteriyor: en eski kaydın
 * yaşı, sınıra oranla.
 *
 * Ölçüt `received_at`, `measured_at` değil — silme de onunla yapılıyor. İki
 * ayrı "eski" tanımı olsaydı ekrandaki çubuk ile cron'un sildiği satır
 * uyuşmaz, pencere dolu görünürken boşalabilirdi (§5'teki gerekçe).
 *
 * Çubuk bir UYARI değil: dolmak beklenen davranış. On günlük pencere dolduğunda
 * sistem bozulmuyor, tasarlandığı gibi çalışıyor — en eski gün düşüyor, yenisi
 * giriyor. Bu yüzden renk kehribara/kırmızıya dönmüyor.
 */
import { Panel, PanelNote } from "@/components/Panel";
import { coverageDays, type RetentionState } from "@/lib/health";
import { localDateTime } from "@/lib/time";

function Count({ label, rows }: { label: string; rows: number }) {
  return (
    <div>
      <p className="text-xl leading-none font-semibold tabular-nums">
        {rows.toLocaleString("en-US")}
      </p>
      <p className="mt-1.5 text-xs text-faint">{label}</p>
    </div>
  );
}

export function RetentionPanel({
  retention,
  now,
  loading,
}: {
  retention: RetentionState | null;
  now: number;
  loading: boolean;
}) {
  const covered = retention
    ? coverageDays(retention.oldestReceivedAt, now)
    : null;

  return (
    <Panel
      title="Retention"
      action={
        retention && (
          <span className="shrink-0 text-[13px] text-faint">
            {retention.retentionDays}-day policy
          </span>
        )
      }
    >
      {loading && !retention ? (
        <PanelNote>Loading…</PanelNote>
      ) : !retention || covered == null ? (
        <PanelNote>Nothing recorded yet.</PanelNote>
      ) : (
        <div className="px-5 pb-5">
          <p className="flex items-baseline gap-1.5 text-xl leading-none font-semibold tabular-nums">
            {covered.toFixed(1)}
            <span className="text-xs font-medium text-muted">
              of {retention.retentionDays} days recorded
            </span>
          </p>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{
                width: `${Math.min(100, (covered / retention.retentionDays) * 100)}%`,
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Count label="Metrics" rows={retention.metrics.rows} />
            <Count label="Logs" rows={retention.logs.rows} />
            <Count label="Snapshots" rows={retention.crashes.rows} />
          </div>

          <p className="mt-4 text-xs text-faint">
            Oldest row {localDateTime(retention.oldestReceivedAt)}. Older rows
            are dropped nightly at 00:00 UTC.
          </p>
        </div>
      )}
    </Panel>
  );
}
