/**
 * Vitrinin ana animasyonu (CLAUDE.md §9.12) — senaryo KİLİTLİ:
 *
 *   uçan bir uçak → uçaktan düşen kara kutu → yere çarpar ve açılır → ekrana
 *   canlı karışık loglar, metrikler, sayılar ve kablolar fırlar → veriler yavaş
 *   yavaş kutuya geri girer → her şeyin çözüldüğünü belli etmek için kutu
 *   turuncudan YEŞİLE döner ve sağa sola sallanır.
 *
 * YAPIM TEKNİĞİ: satır içi SVG + CSS keyframe. §9.12 üç seçenek bırakmıştı
 * (scroll'a bağlı video · Lottie · SVG + GSAP); seçim burada yapıldı.
 *
 *   · Sahne YANDAN SİLUET kurgulandığı için gerçek 3B gerekmiyor — §9.12'nin
 *     kendi notu. Geriye kalan iş birkaç şeklin zamanlanmış hareketi.
 *   · GSAP ~70 KB, Lottie ~250 KB + JSON. İkisi de ziyaretçinin ürüne dair
 *     HİÇBİR ŞEY görmeden önce indirmesi gereken ağırlık; ilk izlenim tam da
 *     "hafif ve hızlı" olması gereken ekranda yavaşlık olurdu.
 *   · CSS keyframe'in maliyeti sıfır: bileşenin kendi markup'ından başka byte
 *     yok, GPU'da bileşikleniyor ve `prefers-reduced-motion` bedavaya geliyor.
 *   · Dashboard'ın hiçbir yerinde grafik kütüphanesi yok (§9.7 grafikleri de
 *     elle çiziliyor); burada bir tane açmak tek başına duran bir istisna olurdu.
 *
 * EŞ ZAMANLAMA: her parça AYNI 15 saniyelik döngüyü paylaşıyor ve kendi
 * dilimini keyframe yüzdeleriyle oyuyor. Ayrı süreler verilseydi sahne birkaç
 * turda kayar, kutu daha yere değmeden içinden veri fırlardı.
 *
 *   0–15%  uçak soldan geçer      15–30%  kutu düşer, çarpar
 *   32–40% kapak açılır           40–58%  veri fırlar
 *   58–74% veri kutuya geri girer 74–80%  kapak kapanır, turuncu → yeşil
 *   80–96% kutu sallanır          96–100% duruş, döngü başa sarar
 */
"use client";

/** Bir "log satırı" pulu: rozet + iki metin çizgisi. */
function LogChip({ tone }: { tone: string }) {
  return (
    <g>
      <rect x="-26" y="-9" width="52" height="18" rx="4" fill="var(--color-panel)" />
      <rect x="-26" y="-9" width="52" height="18" rx="4" fill="none" stroke="var(--color-line)" />
      <rect x="-21" y="-4.5" width="10" height="9" rx="2" fill={tone} />
      <rect x="-7" y="-4" width="28" height="2.5" rx="1.25" fill="var(--color-muted)" />
      <rect x="-7" y="1" width="18" height="2.5" rx="1.25" fill="var(--color-line)" />
    </g>
  );
}

/** Bir sayı pulu — ekrandaki gerçek ölçülerin karşılığı. */
function ValueChip({ text, tone }: { text: string; tone: string }) {
  return (
    <g>
      <rect x="-21" y="-11" width="42" height="22" rx="6" fill="var(--color-panel)" />
      <rect x="-21" y="-11" width="42" height="22" rx="6" fill="none" stroke="var(--color-line)" />
      <text
        x="0"
        y="4"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={tone}
        fontFamily="ui-monospace, monospace"
      >
        {text}
      </text>
    </g>
  );
}

/** Küçük bir zaman çizelgesi parçası. */
function SparkChip() {
  return (
    <g>
      <rect x="-24" y="-13" width="48" height="26" rx="6" fill="var(--color-panel)" />
      <rect x="-24" y="-13" width="48" height="26" rx="6" fill="none" stroke="var(--color-line)" />
      <path
        d="M-17,4 L-11,1 L-6,5 L-1,-6 L4,2 L9,-2 L16,-7"
        fill="none"
        stroke="var(--color-cpu)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Fırlayan/dönen her parça aynı hareketi paylaşıyor; farkı yön ve gecikme. */
function Fragment({
  dx,
  dy,
  spin,
  children,
}: {
  dx: number;
  dy: number;
  spin: number;
  children: React.ReactNode;
}) {
  return (
    <g
      className="fr-fragment"
      style={
        {
          "--dx": `${dx}px`,
          "--dy": `${dy}px`,
          "--spin": `${spin}deg`,
        } as React.CSSProperties
      }
    >
      {children}
    </g>
  );
}

export function FlightRecorderScene() {
  return (
    <div className="relative w-full">
      <style>{`
/* Tüm sahne tek bir süreyi paylaşıyor. */
.fr-scene .fr-plane,
.fr-scene .fr-drop,
.fr-scene .fr-ring,
.fr-scene .fr-lid,
.fr-scene .fr-shell,
.fr-scene .fr-body,
.fr-scene .fr-fragment,
.fr-scene .fr-cable {
  animation-duration: 15s;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
  /* SVG'de transform-origin, kutunun KENDİ kutusuna göre okunsun. Varsayılan
     olarak viewBox'ın köşesine göre okunur ve her dönüş sahneyi savururdu. */
  transform-box: fill-box;
}

/* --- uçak: soldan girer, sağdan çıkar ------------------------------------ */
.fr-scene .fr-plane {
  animation-name: fr-plane;
  animation-timing-function: linear;
}
@keyframes fr-plane {
  0%        { transform: translateX(-140px); opacity: 0; }
  4%        { opacity: 1; }
  30%       { opacity: 1; }
  36%, 100% { transform: translateX(460px); opacity: 0; }
}

/* --- kutu: uçaktan düşer, yere çarpar ------------------------------------
   Düşüşün ivmesi keyframe'e gömülü: 15→30 arası ease-in, yani hız sona
   doğru artıyor. Doğrusal bir düşüş, ağırlığı olmayan bir nesne gibi görünürdü. */
.fr-scene .fr-drop {
  animation-name: fr-drop;
}
@keyframes fr-drop {
  0%, 14%   { transform: translate(-150px, -178px) rotate(-30deg); opacity: 0; }
  15%       { transform: translate(-148px, -176px) rotate(-28deg); opacity: 1;
              animation-timing-function: cubic-bezier(0.5, 0, 0.9, 0.55); }
  30%       { transform: translate(0, 0) rotate(0deg); }
  /* Çarpma sonrası tek bir küçük sıçrama — sert bir duruş, cismin yere
     değdiğini hareketle söylüyor. */
  33%       { transform: translate(0, -9px) rotate(2deg); }
  36%, 100% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
}

/* --- çarpma halkası ------------------------------------------------------ */
.fr-scene .fr-ring { animation-name: fr-ring; }
@keyframes fr-ring {
  0%, 29%   { opacity: 0; transform: scale(0.2); }
  30%       { opacity: 0.55; transform: scale(0.3); }
  40%, 100% { opacity: 0; transform: scale(1.8); }
}

/* --- kapak: açılır, veri geri girince kapanır ---------------------------- */
.fr-scene .fr-lid {
  animation-name: fr-lid;
  transform-origin: left bottom;
}
@keyframes fr-lid {
  0%, 32%   { transform: rotate(0deg); }
  40%, 68%  { transform: rotate(-46deg); }
  78%, 100% { transform: rotate(0deg); }
}

/* --- gövde rengi: turuncu → yeşil (§9.12: "her şey çözüldü") ------------- */
.fr-scene .fr-shell { animation-name: fr-shell; }
@keyframes fr-shell {
  0%, 74%   { fill: #f97316; }
  80%, 100% { fill: #16b364; }
}

/* --- kutu sallanır ------------------------------------------------------- */
.fr-scene .fr-body {
  animation-name: fr-rock;
  transform-origin: bottom center;
}
@keyframes fr-rock {
  0%, 80%   { transform: rotate(0deg); }
  84%       { transform: rotate(-7deg); }
  88%       { transform: rotate(6deg); }
  92%       { transform: rotate(-4deg); }
  96%, 100% { transform: rotate(0deg); }
}

/* --- fırlayan veri ------------------------------------------------------- */
.fr-scene .fr-fragment { animation-name: fr-fragment; }
@keyframes fr-fragment {
  0%, 38%   { opacity: 0; transform: translate(0, 0) scale(0.2) rotate(0deg); }
  44%       { opacity: 1; }
  58%       { opacity: 1;
              transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--spin)); }
  66%       { opacity: 1;
              transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--spin)); }
  76%, 100% { opacity: 0; transform: translate(0, 0) scale(0.2) rotate(0deg); }
}

/* --- kablolar: veriyle birlikte fırlar, onunla geri girer ---------------- */
.fr-scene .fr-cable { animation-name: fr-cable; }
@keyframes fr-cable {
  0%, 40%   { opacity: 0; stroke-dashoffset: 200; }
  50%, 66%  { opacity: 0.5; stroke-dashoffset: 0; }
  74%, 100% { opacity: 0; stroke-dashoffset: 200; }
}

/*
 * Hareket azaltma tercihi MUTLAK: animasyon tamamen durur ve sahne SON
 * hâliyle (yerde duran yeşil kutu) kalır. Vestibüler rahatsızlığı olan bir
 * ziyaretçi için ekranın ortasında dönüp duran bir sahne, sayfayı kullanılamaz
 * kılar. "Yavaşlat" yetmez; şart olan, hareketin hiç olmaması.
 */
@media (prefers-reduced-motion: reduce) {
  .fr-scene * { animation: none !important; }
  .fr-scene .fr-plane,
  .fr-scene .fr-ring,
  .fr-scene .fr-fragment,
  .fr-scene .fr-cable { opacity: 0; }
  .fr-scene .fr-shell { fill: #16b364; }
}
      `}</style>

      <svg
        viewBox="0 0 420 280"
        className="fr-scene w-full"
        role="img"
        aria-label="A flight recorder falls from a plane, spills the logs and metrics it captured, then takes them safely back in."
      >
        {/* --- zemin -----------------------------------------------------
            Çizgi ekranın iki ucuna kadar gitmiyor, uçlarda soluyor: sahnenin
            bir kesit olduğunu, çerçevenin dışında da devam ettiğini söylüyor. */}
        <defs>
          <linearGradient id="fr-ground" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--color-line)" stopOpacity="0" />
            <stop offset="0.5" stopColor="var(--color-line)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--color-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="238" width="420" height="1.5" fill="url(#fr-ground)" />

        {/* --- uçak (yandan siluet, burun sağda) -------------------------- */}
        <g className="fr-plane" fill="var(--color-muted)" opacity="0.9">
          <g transform="translate(0,44)">
            <path d="M0,14 Q7,6 28,5 L74,5 Q93,6 102,14 Q93,22 74,23 L28,23 Q7,22 0,14 Z" />
            <path d="M8,14 L3,-2 L18,1 L24,11 Z" />
            <path d="M50,20 L38,34 L58,34 L64,22 Z" />
          </g>
        </g>

        {/* --- kutu ve etrafında olan her şey ----------------------------- */}
        <g transform="translate(212,238)">
          {/* çarpma halkası — kutunun ALTINDA, yere ait */}
          <circle
            className="fr-ring"
            cx="0"
            cy="0"
            r="26"
            fill="none"
            stroke="var(--color-warn)"
            strokeWidth="2"
          />

          <g className="fr-drop">
            {/* fırlayan veri: kutunun İÇİNDEN çıkıyor, o yüzden aynı köke bağlı */}
            <g transform="translate(0,-16)">
              <Fragment dx={-118} dy={-84} spin={-8}>
                <LogChip tone="var(--color-danger)" />
              </Fragment>
              <Fragment dx={112} dy={-96} spin={7}>
                <LogChip tone="var(--color-warn)" />
              </Fragment>
              <Fragment dx={-146} dy={-14} spin={5}>
                <SparkChip />
              </Fragment>
              <Fragment dx={146} dy={-26} spin={-6}>
                <LogChip tone="var(--color-info)" />
              </Fragment>
              <Fragment dx={-58} dy={-136} spin={-10}>
                <ValueChip text="94%" tone="var(--color-danger)" />
              </Fragment>
              <Fragment dx={54} dy={-142} spin={9}>
                <ValueChip text="1.9G" tone="var(--color-ram)" />
              </Fragment>
              <Fragment dx={-190} dy={-72} spin={11}>
                <ValueChip text="0.74" tone="var(--color-cpu)" />
              </Fragment>
              <Fragment dx={186} dy={-84} spin={-9}>
                <SparkChip />
              </Fragment>

              {/* kablolar */}
              <path
                className="fr-cable"
                d="M0,0 C-46,-24 -70,-70 -118,-84"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="1.6"
                strokeDasharray="200"
                strokeLinecap="round"
              />
              <path
                className="fr-cable"
                d="M0,0 C44,-30 74,-72 112,-96"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="1.6"
                strokeDasharray="200"
                strokeLinecap="round"
              />
              <path
                className="fr-cable"
                d="M0,0 C-60,-4 -104,-10 -146,-14"
                fill="none"
                stroke="var(--color-cpu)"
                strokeWidth="1.6"
                strokeDasharray="200"
                strokeLinecap="round"
              />
            </g>

            {/* kutunun kendisi — sallanan kısım */}
            <g className="fr-body">
              {/* kapak: sol kenarından menteşeli */}
              <g className="fr-lid">
                <rect
                  x="-26"
                  y="-40"
                  width="52"
                  height="11"
                  rx="3"
                  fill="var(--color-fg)"
                  opacity="0.85"
                />
              </g>

              {/* gövde */}
              <rect
                className="fr-shell"
                x="-26"
                y="-30"
                width="52"
                height="30"
                rx="4"
              />
              {/* uçuş kaydedicilerin şeridi + tutamak */}
              <rect x="-26" y="-20" width="52" height="4" fill="var(--color-fg)" opacity="0.25" />
              <rect x="-9" y="-45" width="18" height="4" rx="2" fill="var(--color-fg)" opacity="0.55" />
              <circle cx="-16" cy="-8" r="2.4" fill="var(--color-fg)" opacity="0.35" />
              <circle cx="16" cy="-8" r="2.4" fill="var(--color-fg)" opacity="0.35" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
