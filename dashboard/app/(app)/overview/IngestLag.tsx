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

/**
 * Damgayı UTC olarak yazar.
 *
 * Yerel saat DEĞİL, bilerek: bu satır kullanıcının kendi takvimindeki bir anı
 * değil, `received_at`/`measured_at` çiftini anlatıyor ve veritabanındaki her
 * şey UTC (§9.5). Buradaki tek amaç kullanıcının o anı bir kesintiyle
 * eşleştirebilmesi; iki ayrı saat dilimi arasında zihinden çeviri yaptırmak
 * tam da o eşleştirmeyi zorlaştırırdı.
 */
function formatUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function IngestLagPanel({
  lag,
  loading,
}: {
  lag: IngestLagData | null;
  loading: boolean;
}) {
  /* Örneklemin kapsadığı süre: en eski varış ile en yenisi arası. */
  const windowMs =
    lag?.windowStartAt && lag.lastReceivedAt
      ? Math.max(0, Date.parse(lag.lastReceivedAt) - Date.parse(lag.windowStartAt))
      : null;

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

          {/*
            Sayıya ZAMAN çerçevesi ekleniyor. "500 satır" tek başına bir adet;
            kullanıcının "16.2 saat" ile karşılaştıracağı şey ise bir SÜRE.
            Çerçeve yazılmayınca en kötü değer okunamaz hâlde kalıyordu —
            §9.6 madde 5'in grafiğe koyduğu "ne gösterdiğini söyle" kuralı.
          */}
          <p className="mt-4 text-xs text-faint">
            Over the last {lag.samples} metric rows
            {windowMs != null && <> — {formatLag(windowMs)} of arrivals</>}.
          </p>

          {/*
            En kötü örnek pencereden ESKİYSE bunu yazmak zorunlu: o satır
            tanımı gereği canlı yoldan gelmedi, birikmiş kuyruktan geldi.
            Yazılmasaydı kullanıcı yazma yolunun saatlerce yavaş olduğunu
            sanırdı — oysa gördüğü şey spool'un işini yapması.

            Yorum tek cümleyle sınırlı ve alternatifi de söylüyor: saati geri
            kalmış bir cihaz veride BUNUNLA AYNI görünür, satırın kendi
            damgaları ikisini ayırt edemez. Ayırt edemediğimiz şeyi teşhis
            diye sunmak, panelin kendi dürüstlük kuralını çiğnemek olurdu.

            Pencere LAG_OK_MS'ten darsa hiç yazılmıyor. Yeni kurulmuş bir
            sistemde elde iki satır olabilir; o zaman pencere neredeyse sıfır
            genişliğinde olur ve saniyelik NORMAL bir gecikme bile "pencereden
            eski" sayılıp birikmiş kuyruk diye ilan edilirdi.
          */}
          {windowMs != null &&
            windowMs >= LAG_OK_MS &&
            lag.maxMs > windowMs &&
            lag.worstMeasuredAt && (
            <p className="mt-2 text-xs text-faint">
              The worst sample was measured{" "}
              <span className="text-muted">{formatUtc(lag.worstMeasuredAt)}</span>,
              before this window opened — it reached the database from a spool
              backlog, not from the live path. A host clock running behind would
              look the same here.
            </p>
          )}

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
