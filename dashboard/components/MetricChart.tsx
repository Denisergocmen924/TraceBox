/**
 * Çizim alanı — referans 2'nin "System Metrics" düzeni.
 *
 * Bileşen HANGİ ölçüyü çizdiğini bilmiyor; kendisine verilen "iz"leri (Track,
 * lib/metrics.ts) çiziyor. Böylece donanım grafiği (CPU/RAM/Disk, sabit %0–100
 * ekseni) ile ağ grafiği (gelen/giden, tavanı veriden çıkan serbest eksen)
 * AYNI bileşen oluyor. İkisi ayrı yazılsaydı sürükleme, imleç, boşluk ayırma
 * ve eksen mantığı iki kez yaşardı; biri düzeltilir, öteki unutulurdu.
 *
 * Tek çizim alanı, çizgiler ÜST ÜSTE. Y ekseni solda, kılavuzlar kesikli,
 * gösterge çizim alanının içinde sağ üstte, saat etiketleri altta. Overview'daki
 * geniş grafikle aynı dil — iki ekranın iki ayrı grafik dili konuşması marka
 * tutarlılığını bozardı (§9.11.1: "görsel dil birebir alınır").
 *
 * BANT (min–max) çizgilerin ARKASINDA soluk bir dolgu: §9.6 madde 6 kilitli —
 * yalnızca ortalama çizmek 5 saniyelik patlamayı yutar, yalnızca max çizmek
 * makineyi olduğundan yoğun gösterir. Yakınlaştıkça kovalar tek örneğe iner,
 * min = max olur ve bant kendiliğinden kaybolur; ekranda referanstaki gibi ince
 * çizgiler kalır.
 *
 * Çizim el yazımı SVG; grafik kütüphanesi yok. Gereken şey birkaç path, bir
 * imleç ve bir seçim dikdörtgeni — bunun için ~100 KB bağımlılık taşımak
 * "over-engineering yok" ilkesine ters düşerdi. Ayrıca §9.8 fare tekerleğiyle
 * yakınlaştırmayı YASAKLIYOR; hazır kütüphanelerin çoğunda o davranış
 * varsayılan ve kapatmak, kendi çizmekten daha çok uğraş çıkarıyor.
 *
 * viewBox sabit ve preserveAspectRatio="none": koordinat matematiği yüzdelere
 * dönüşmeden basit kalıyor, SVG kabına göre esniyor. Esneme çizgi kalınlığını
 * bozardı, onu vector-effect="non-scaling-stroke" tutuyor. Metin bu yüzden SVG
 * İÇİNDE yok — yatay/dikey esneme yazıyı ezerdi; eksen etiketleri ve imleç
 * noktaları HTML olarak dışarıda duruyor.
 */
"use client";

import type { MetricBucket, Point, Track } from "@/lib/metrics";
import { axisTicks, axisTime } from "@/lib/time";

/** Çizim uzayı. Gerçek piksel değil; oran taşıyan bir koordinat sistemi. */
const VIEW_W = 1000;
const VIEW_H = 300;

/** Y ekseni: tavandan sıfıra dört eşit adım — referanstaki beş etiket. */
const GRID = [1, 0.75, 0.5, 0.25, 0];

export function MetricChart({
  tracks,
  buckets,
  ceiling,
  formatAxis,
  height = 260,
  note,
  fromMs,
  toMs,
  plotToMs,
  hoverIndex,
  onHoverTime,
  dragFrom,
  dragTo,
  onDragStart,
  onDragMove,
}: {
  tracks: Track[];
  /** İmleç okuması kovanın HAM değerlerini gösteriyor; izler ölçeklenmiş. */
  buckets: MetricBucket[];
  ceiling: number;
  /** Y ekseni etiketi — yüzdede "75%", ağda "1.2 Mbps". */
  formatAxis: (value: number) => string;
  height?: number;
  /** Eksik bir izin sebebini açıklayan satır (varsa grafiğin altında). */
  note?: string | null;
  fromMs: number;
  toMs: number;
  /**
   * Eksenin bittiği an — verinin bittiği an DEĞİL. Aradaki fark, sağda
   * bırakılan boş pay (lib/metrics.ts → plotEndMs). Ayrı bir prop, çünkü payın
   * uygulanıp uygulanmayacağı kilit durumuna bağlı ve onu bilen Timeline;
   * çizim alanı hangi ölçüyü çizdiğini de, akışın açık olup olmadığını da
   * bilmiyor.
   */
  plotToMs: number;
  hoverIndex: number | null;
  onHoverTime: (t: number | null) => void;
  /** Sürmekte olan seçim. Seçim yoksa null. */
  dragFrom: number | null;
  dragTo: number | null;
  onDragStart: (t: number) => void;
  onDragMove: (t: number) => void;
}) {
  /** Verinin genişliği — etiket sıklığı ve okuma bunun üstünden. */
  const span = Math.max(1, toMs - fromMs);
  /** Çizim uzayının genişliği. Sağdaki boş pay yüzünden `span`'dan büyük. */
  const viewSpan = Math.max(1, plotToMs - fromMs);
  const top = ceiling > 0 ? ceiling : 1;

  const x = (t: number) => ((t - fromMs) / viewSpan) * VIEW_W;
  const y = (v: number) =>
    VIEW_H - (Math.min(Math.max(v, 0), top) / top) * VIEW_H;

  // Kılavuz çizgileri ve etiketler boş payın İÇİNE de sürüyor: ritim orada
  // kesilseydi payın kendisi "eksen bitti" gibi okunurdu. Adım yine verinin
  // genişliğinden seçiliyor (lib/time.ts → axisTicks).
  const ticks = axisTicks(fromMs, toMs, plotToMs);
  const hovered = hoverIndex == null ? null : (buckets[hoverIndex] ?? null);
  const hoverX = hovered ? x(Date.parse(hovered.bucket_start)) : null;

  /** Fare imlecinin altındaki an. Kutunun dışına taşarsa uçlara kırpılır. */
  function timeAt(event: React.MouseEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - box.left) / box.width;
    const t = fromMs + Math.min(1, Math.max(0, fraction)) * viewSpan;
    // Boş paya taşan imleç VERİNİN SONUNA kırpılıyor. Kırpılmasaydı orada
    // başlayan bir seçim, hiç ölçüm olmayan bir aralığı çerçeveler ve
    // kullanıcı boş bir grafiğe yakınlaşırdı.
    return Math.min(t, toMs);
  }

  function handleMove(event: React.MouseEvent<HTMLDivElement>) {
    const t = timeAt(event);
    onHoverTime(t);
    // Seçim sürerken imleç de çalışmaya devam ediyor: kullanıcı neyi seçmek
    // üzere olduğunu değerlerle birlikte görüyor.
    if (dragFrom != null) onDragMove(t);
  }

  return (
    <div className="px-5 pb-5 pt-4">
      <div className="flex gap-2">
        {/* --- y ekseni ----------------------------------------------------
            Etiketler çizginin ORTASINA hizalı (-translate-y-1/2), üstten akan
            bir kolonla değil: akan kolonda ilk ve son etiket yarım satır kayar
            ve en üstteki etiket ile en üstteki kılavuz asla buluşmaz. */}
        <div
          className="relative w-14 shrink-0"
          style={{ height: `${height}px` }}
        >
          {GRID.map((g) => (
            <span
              key={g}
              className="absolute right-0 -translate-y-1/2 tabular-nums text-[11px] text-muted"
              style={{ top: `${(1 - g) * 100}%` }}
            >
              {formatAxis(top * g)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="relative cursor-crosshair select-none border-b border-l border-line"
            style={{ height: `${height}px` }}
            onMouseMove={handleMove}
            onMouseLeave={() => onHoverTime(null)}
            onMouseDown={(event) => {
              // Sol tuş dışındaki düğmeler seçim başlatmaz: sağ tuş bağlam
              // menüsünü açar ve orta tuş bazı tarayıcılarda otomatik
              // kaydırmaya geçer — ikisi de yarım kalmış bir seçim bırakırdı.
              if (event.button !== 0) return;
              // Tarayıcının kendi metin seçimi devreye girmesin; sürükleme
              // sırasında sayfadaki yazılar maviye boyanırdı.
              event.preventDefault();
              onDragStart(timeAt(event));
            }}
          >
            {/* yatay kılavuzlar */}
            {GRID.map((g) => (
              <span
                key={g}
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line"
                style={{ top: `${(1 - g) * 100}%` }}
              />
            ))}
            {/* dikey kılavuzlar — x etiketleriyle aynı anlarda */}
            {ticks.map((t) => (
              <span
                key={t}
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line"
                style={{ left: `${((t - fromMs) / viewSpan) * 100}%` }}
              />
            ))}

            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="absolute inset-0 size-full"
            >
              {/* Bantlar ÖNCE, hepsi birden: çizgilerin altında kalsınlar.
                  İz iz (bant, çizgi) çizilseydi ikinci izin bandı birinci izin
                  çizgisini örterdi. */}
              {tracks.map((track) =>
                track.segments.map((segment, i) =>
                  segment.length < 2 ? null : (
                    <path
                      key={`band-${track.key}-${i}`}
                      d={bandPath(segment, x, y)}
                      className={track.tone.band}
                    />
                  ),
                ),
              )}

              {tracks.map((track) =>
                track.segments.map((segment, i) =>
                  segment.length < 2 ? (
                    // Tek noktalık parça çizgi çizemez ama görünmeli: iki
                    // boşluk arasında sıkışmış tek ölçüm ekranda hiç yer
                    // almazdı. Sıfır uzunlukta segment + yuvarlak uç = nokta.
                    <path
                      key={`dot-${track.key}-${i}`}
                      d={`M${x(segment[0].t)},${y(segment[0].avg)}L${x(segment[0].t)},${y(segment[0].avg)}`}
                      className={track.tone.line}
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <path
                      key={`line-${track.key}-${i}`}
                      d={linePath(segment, x, y)}
                      className={track.tone.line}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      /* Kesikli izde uç YUVARLAK DEĞİL düz: yuvarlak uçlar her
                         kesiğin iki ucuna yarım daire ekleyip boşlukları
                         doldurur, desen de kaybolurdu. */
                      strokeLinecap={track.dashed ? "butt" : "round"}
                      strokeDasharray={track.dashed ? "5 4" : undefined}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  ),
                ),
              )}

              {/* Seçim dikdörtgeni. İmleç çizgisinden ÖNCE çiziliyor: SVG'de
                  sonra gelen üstte durur ve dolgu, imleci yutardı. */}
              {dragFrom != null && dragTo != null && (
                <rect
                  x={Math.min(x(dragFrom), x(dragTo))}
                  width={Math.abs(x(dragTo) - x(dragFrom))}
                  y={0}
                  height={VIEW_H}
                  className="fill-accent/15 stroke-accent/50"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {hoverX != null && (
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={0}
                  y2={VIEW_H}
                  className="stroke-fg/35"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/*
              İmlecin altındaki değerleri işaretleyen noktalar — SVG'nin İÇİNDE
              DEĞİL, üstünde duran HTML öğeleri.

              Sebep: preserveAspectRatio="none", yani SVG kabına göre yatayda ve
              dikeyde farklı oranlarda esniyor. İçeriye konan bir daire o
              esnemeyle birlikte yayvan bir elipse dönerdi; vector-effect
              yalnızca çizgi kalınlığını kurtarır, şekli değil. Dışarıda yüzdeyle
              konumlanan bir nokta her boyutta yuvarlak kalıyor.
            */}
            {hovered &&
              hoverX != null &&
              tracks.map((track) => {
                const band = track.pick(hovered);
                if (band.avg == null) return null;
                return (
                  <span
                    key={`cursor-${track.key}`}
                    className={`pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel ${track.tone.bar}`}
                    style={{
                      left: `${(hoverX / VIEW_W) * 100}%`,
                      top: `${(y(band.avg * track.scale) / VIEW_H) * 100}%`,
                    }}
                  />
                );
              })}

            {/* --- gösterge (referans: grafiğin İÇİNDE sağ üstte) ------------
                İmleç varken aynı yerde DEĞERİ de yazıyor. Ayrı bir yüzen kutu
                açmak yerine göstergeyi çift işlevli yapmak, referansın
                yerleşimini bozmadan okumayı çözüyor. Değer izin KENDİ biriminde
                (RAM'de GB, ağda Mbps): eksen zaten ölçeği söylüyor. */}
            <div className="pointer-events-none absolute right-2 top-2 flex flex-wrap justify-end gap-x-4 gap-y-1">
              {tracks.map((track) => {
                const band = hovered ? track.pick(hovered) : null;
                return (
                  <span
                    key={`legend-${track.key}`}
                    className="flex items-center gap-1.5 text-xs text-muted"
                  >
                    <span
                      className={
                        track.dashed
                          ? // Kesikli göstergeyi maskeyle çiziyoruz: renk zaten
                            // `bg-*` sınıfında, tekrar yazsaydık palet iki
                            // yerde tanımlanmış olurdu.
                            `h-[3px] w-3.5 ${track.tone.bar} [mask-image:repeating-linear-gradient(to_right,#000_0_4px,transparent_4px_7px)]`
                          : `h-[3px] w-3.5 rounded-full ${track.tone.bar}`
                      }
                    />
                    {track.label}
                    {band?.avg != null && (
                      <span className="tabular-nums font-medium text-fg">
                        {track.format(band.avg)}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {/* --- x ekseni ------------------------------------------------- */}
          <div className="relative mt-2 h-4">
            {ticks
              // Sağ uca yapışan etiket kartın dışına taşardı.
              .filter((t) => (t - fromMs) / viewSpan < 0.97)
              .map((t) => (
                <span
                  key={t}
                  className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums text-[11px] text-muted"
                  style={{ left: `${((t - fromMs) / viewSpan) * 100}%` }}
                >
                  {axisTime(t, span)}
                </span>
              ))}
          </div>
        </div>
      </div>

      {note && <p className="mt-3 text-[11px] text-faint">{note}</p>}
    </div>
  );
}

/** Üstten max boyunca ileri, alttan min boyunca geri: kapalı bant. */
function bandPath(
  points: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  const top = points.map((p) => `${x(p.t)},${y(p.max)}`);
  const bottom = [...points].reverse().map((p) => `${x(p.t)},${y(p.min)}`);
  return `M${top.join("L")}L${bottom.join("L")}Z`;
}

function linePath(
  points: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  return `M${points.map((p) => `${x(p.t)},${y(p.avg)}`).join("L")}`;
}
