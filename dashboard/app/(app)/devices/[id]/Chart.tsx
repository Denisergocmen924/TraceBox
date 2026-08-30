/**
 * Tek ölçünün grafiği: bant + çizgi (CLAUDE.md §9.6).
 *
 * BANT min–max, İÇİNDEN GEÇEN ÇİZGİ ortalama. İkisi birlikte çizilir çünkü
 * ikisi ayrı soruya cevap verir: çizgi "makine genelde ne durumdaydı", bant
 * "en kötü an neydi". Yalnızca ortalama çizilseydi 15 dakikalık bir kovanın
 * içindeki 5 saniyelik patlama görünmezdi — ve o patlamayı göstermek bu
 * projenin varlık sebebi. Yalnızca max çizilseydi makine sürekli yanıyormuş
 * gibi görünürdü.
 *
 * Çizim el yazımı SVG; grafik kütüphanesi eklenmedi. Gereken şey iki path,
 * birkaç ızgara çizgisi ve bir imleç — bunun için ~100 KB bağımlılık taşımak
 * "over-engineering yok" ilkesine ters düşerdi. Ayrıca §9.8 fare tekerleğiyle
 * yakınlaştırmayı YASAKLIYOR; hazır kütüphanelerin çoğunda o davranış
 * varsayılan ve kapatmak, kendi çizmekten daha çok uğraş çıkarıyor.
 *
 * viewBox sabit (1000×100) ve preserveAspectRatio="none": koordinat matematiği
 * yüzdelere dönüşmeden basit kalıyor, SVG kabına göre esniyor. Esneme çizgi
 * kalınlığını da bozardı, onu vector-effect="non-scaling-stroke" tutuyor.
 * Metin bu yüzden SVG İÇİNDE yok — yatay/dikey esneme yazıyı ezerdi; eksen
 * etiketleri HTML olarak dışarıda duruyor.
 */
"use client";

import { useMemo } from "react";
import {
  ceilingFor,
  formatValue,
  splitOnGaps,
  thresholdFor,
  toPoints,
  type MetricBucket,
  type Point,
  type SeriesDef,
} from "@/lib/metrics";

/** viewBox birimleri. Piksel değil — SVG kabına göre esner. */
const W = 1000;
const H = 100;

export function Chart({
  series,
  buckets,
  ramTotalMb,
  fromMs,
  toMs,
  widthMs,
  hoverIndex,
  onHoverTime,
}: {
  series: SeriesDef;
  buckets: MetricBucket[];
  /** RAM grafiğinin tavanı. Yüzde grafikleri bunu kullanmaz. */
  ramTotalMb: number | null;
  fromMs: number;
  toMs: number;
  /** Bir kovanın süresi — boşluk tespiti bunu ölçüt alır. */
  widthMs: number;
  hoverIndex: number | null;
  onHoverTime: (t: number | null) => void;
}) {
  const { segments, ceiling, threshold } = useMemo(() => {
    const points = toPoints(buckets, series);
    const ceil = ceilingFor(series, ramTotalMb, points);
    return {
      segments: splitOnGaps(points, widthMs),
      ceiling: ceil,
      threshold: thresholdFor(series, ceil),
    };
  }, [buckets, series, ramTotalMb, widthMs]);

  const span = Math.max(1, toMs - fromMs);
  const x = (t: number) => ((t - fromMs) / span) * W;
  const y = (v: number) => H - (Math.min(Math.max(v, 0), ceiling) / ceiling) * H;

  const hovered = hoverIndex == null ? null : buckets[hoverIndex];
  const hoveredBand = hovered ? series.pick(hovered) : null;

  function handleMove(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - box.left) / box.width;
    onHoverTime(fromMs + fraction * span);
  }

  return (
    <div className="px-5 py-3">
      <div className="flex items-baseline gap-2 text-xs">
        {/* Lejant (plan §6). Nokta, aşağıdaki çizgiyle AYNI renk sınıfından
            besleniyor; iki yerde ayrı ayrı seçilseydi biri değiştiğinde
            lejant sessizce yanlış ölçüyü göstermeye başlardı. */}
        <span
          className={`size-2 shrink-0 rounded-full ${series.tone.bar}`}
          aria-hidden="true"
        />
        <span className="font-medium">{series.label}</span>

        {/* Okuma satırı. İmleç yokken eksenin tavanını yazar: grafiğin
            yüksekliğinin ne demek olduğu tahmine bırakılmamalı. */}
        <span className="ml-auto tabular-nums text-muted">
          {hoveredBand && hoveredBand.avg != null ? (
            <>
              en düşük {formatValue(series, hoveredBand.min ?? 0)} · ortalama{" "}
              <span className="text-fg">
                {formatValue(series, hoveredBand.avg)}
              </span>{" "}
              · en yüksek {formatValue(series, hoveredBand.max ?? 0)}
            </>
          ) : (
            <>0 – {formatValue(series, ceiling)}</>
          )}
        </span>
      </div>

      <div
        className="relative mt-2 h-24 cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverTime(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          {/* Izgara: dörtte birler. Değer okumak için değil, göz hizası için. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={H * f}
              y2={H * f}
              className="stroke-line"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Acil gönderim eşiği. Bu çizginin üstü keyfi bir "tehlike" değil:
              agent orada spool'u beklemeden anında boşaltır (§7). */}
          {threshold < ceiling && (
            <line
              x1={0}
              x2={W}
              y1={y(threshold)}
              y2={y(threshold)}
              className="stroke-warn/40"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {segments.map((segment, i) =>
            segment.length === 1 ? (
              // Tek noktalık parça: bant kapalı bir alan oluşturamaz, dolgu
              // görünmez. Min–max yine de kaybolmasın diye dikey çizgi.
              <line
                key={`band-${i}`}
                x1={x(segment[0].t)}
                x2={x(segment[0].t)}
                y1={y(segment[0].max)}
                y2={y(segment[0].min)}
                className={series.tone.line + " opacity-50"}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <path
                key={`band-${i}`}
                d={bandPath(segment, x, y)}
                className={series.tone.band}
              />
            ),
          )}

          {segments.map((segment, i) => (
            <path
              key={`line-${i}`}
              d={linePath(segment, x, y)}
              className={series.tone.line}
              strokeWidth={1.5}
              strokeLinejoin="round"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hovered && (
            <line
              x1={x(Date.parse(hovered.bucket_start))}
              x2={x(Date.parse(hovered.bucket_start))}
              y1={0}
              y2={H}
              className="stroke-fg/35"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

        </svg>

        {/*
          İmlecin altındaki ortalama değeri işaretleyen nokta — SVG'nin İÇİNDE
          DEĞİL, üstünde duran bir HTML öğesi.

          Sebep: viewBox 1000x100 ve preserveAspectRatio="none", yani SVG kabına
          göre yatayda ve dikeyde farklı oranlarda esniyor. İçeriye konan bir
          daire o esnemeyle birlikte yayvan bir elipse dönerdi;
          vector-effect yalnızca çizgi kalınlığını kurtarır, şekli değil.
          Dışarıda yüzdeyle konumlanan bir nokta her boyutta yuvarlak kalıyor.
        */}
        {hovered && hoveredBand?.avg != null && (
          <span
            className={`pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg ${series.tone.bar}`}
            style={{
              left: `${(x(Date.parse(hovered.bucket_start)) / W) * 100}%`,
              top: `${(y(hoveredBand.avg) / H) * 100}%`,
            }}
          />
        )}
      </div>
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
