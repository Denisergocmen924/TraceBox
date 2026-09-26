/**
 * Açılış filmi — /login'in üstünde duran tam ekran katman.
 *
 * Sıra: video oynar → bitişine YARIM SANİYE KALA karartma binmeye ve giriş
 * ekranı belirmeye başlar → film bu sırada oynamaya DEVAM eder → son karesinde
 * durur → katman silinir. Kesme yok, yükleniyor ekranı yok.
 *
 * Örtüşme bilinçli: film önce durup sonra form gelseydi arada bir "durdu"
 * anı olurdu. Form filmin üstünde belirdiği için (page.tsx'te z sırası) bu
 * yarım saniyede ikisi aynı anda ekranda.
 *
 * Sürekliliği sağlayan şey şu: bu katman silindiğinde altında duran sayfanın
 * arka planı `poster-last.jpg`, yani donan karenin ta kendisi. Karartma da iki
 * tarafta AYNI (aşağıdaki `SCRIM`). İkisi eşitken katmanın kaldırılması
 * piksel düzeyinde görünmez.
 *
 * Katman yalnızca GÖRSELDİR. Form bu bileşene hiç bağlı değil: aynı anda
 * DOM'da duruyor, `inert` ile dokunulmaz hâlde bekliyor ve video hiç
 * oynamasa bile açılıyor (page.tsx).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Son karenin üstündeki karartma. `page.tsx` AYNI değeri kullanıyor — ikisi
 * eşit olmazsa katman silindiği anda arka plan sıçrar. Renk koyu temanın
 * `--color-bg`'si (#070b15); değişmesi gerekirse iki yerde birden değişir.
 *
 * Oran ölçülerek seçildi. Filmin KENDİSİ sonunda kararıyor: ortalama
 * parlaklık son saniyede 49'dan 30'a (255 üzerinden) iniyor. Bunun üstüne
 * 0,72 binince sahne pratikte yok oluyordu — dağlar kayboluyor, yeşil LED
 * 66/255'e düşüyordu. 0,42'de kutu, "TB" ve LED (125/255) okunur kalıyor ve
 * sahne yine de formun gerisinde duruyor.
 */
export const SCRIM = "rgba(7, 11, 21, 0.42)";

/** sessionStorage anahtarı: film bu sekmede oynadı mı. */
export const OPENING_SEEN_KEY = "tracebox.opening.seen";

/**
 * Filmin kadrajı — kural globals.css'te, gerekçesiyle birlikte.
 *
 * Aynı sınıf hem videoya hem de son kareyi gösteren arka plan katmanına
 * veriliyor; ikisi tek kuralı paylaştığı için kadrajları ayrışamaz.
 */
export const FILM_FRAMING = "film-framing";

/** Dikey ekranda arka plan katmanını film penceresiyle aynı yere oturtur. */
export const FILM_BACKDROP = "film-backdrop";

/** Dikey ekranda film penceresini kapsayıcıda ortalar. */
const FILM_STAGE = "film-stage";

/**
 * Video bu süre içinde oynamaya BAŞLAMAZSA katman kendini kapatır.
 * Ölçüt oynatma süresi değil başlama süresi — video 6,8 saniye ve sonuna
 * kadar beklenmesi normal. Burada sorulan soru "hiç başlayacak mı".
 */
const START_TIMEOUT_MS = 2500;

/**
 * Giriş ekranı, filmin bitişine bu kadar KALA belirir; film o sırada oynamaya
 * devam eder. Süre dosyadan okunuyor (`video.duration`), sabit yazılmıyor —
 * film değişirse zamanlama kendiliğinden ona uyar.
 */
const EARLY_REVEAL_MS = 500;

/** Karartmanın oturma süresi. */
const DIM_MS = 900;

/** Karartma oturduktan sonra katmanın DOM'dan çıkma süresi. */
const FADE_MS = 700;

type Props = {
  /** Karartma başlarken çağrılır — giriş ekranı artık belirebilir. */
  onReveal: () => void;
};

export function OpeningSequence({ onReveal }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // "playing" → film oynuyor · "dimming" → karartma biniyor ve form belirdi
  // (film hâlâ oynuyor olabilir) · "gone" → katman DOM'dan çıktı
  const [phase, setPhase] = useState<"playing" | "dimming" | "gone">("playing");

  /*
   * onReveal ref'te tutuluyor. Parent her render'da yeni bir fonksiyon
   * üretirse bu bir bağımlılık olarak aşağıdaki effect'i yeniden çalıştırır
   * ve zamanlayıcılar sıfırlanırdı — film sonsuza kadar bitmezdi.
   */
  const reveal = useRef(onReveal);
  reveal.current = onReveal;

  // Çıkışın BİR KEZ başlamasını garanti eder: erken zamanlayıcı, onEnded,
  // onError ve zaman aşımı aynı anda gelebilir.
  const started = useRef(false);

  /**
   * Karartmayı başlatır ve giriş ekranını açar.
   *
   * `freeze` filmin DURDURULUP durdurulmayacağını söyler. Normal akışta
   * yanlıştır: çıkış bitişten yarım saniye önce başlar ve film o yarım
   * saniyeyi oynamaya devam eder. Atlama/hata yollarında doğrudur — orada
   * film nerede yakalandıysa o kare ekranda kalır.
   */
  const beginOutro = useCallback((freeze: boolean) => {
    if (started.current) return;
    started.current = true;

    // `pause` yeterli: video kaynağı boşaltılmıyor, görüntü silinmiyor.
    if (freeze) videoRef.current?.pause();
    setPhase("dimming");
  }, []);

  /** Atlama / hata / zaman aşımı: film olduğu yerde durur. */
  const end = useCallback(() => beginOutro(true), [beginOutro]);

  // --- oynatmayı başlat -----------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    /*
     * Tarayıcı yalnızca SESSİZ videoyu kendiliğinden oynatır. `muted` JSX'te
     * de var ama burada bir kez daha yazılıyor: React bunu öznitelik olarak
     * değil özellik olarak kuruyor ve ilk boyamadan önce kurulmadığı
     * durumlarda oynatma sessizce reddedilir.
     */
    video.muted = true;

    // play() bir Promise döner ve REDDEDİLEBİLİR (otomatik oynatma engeli,
    // güç tasarrufu kipi). Reddi yakalamazsak katman ekranda takılı kalırdı.
    void video.play().catch(end);

    /*
     * ERKEN ÇIKIŞ — bitişe EARLY_REVEAL_MS kala.
     *
     * Zamanlayıcı her `timeupdate`te (saniyede ~4) kalan süreden yeniden
     * kuruluyor. Tek seferlik kurulsa arabelleğe takılan bir oynatmada
     * gerçek bitişten önce ateşlenirdi; yeniden kurulunca duraklama kendini
     * düzeltiyor.
     */
    let early = 0;
    const schedule = () => {
      const left =
        (video.duration - video.currentTime) * 1000 - EARLY_REVEAL_MS;
      // Süre henüz bilinmiyorsa (NaN) bir şey yapma — onEnded yedekte duruyor.
      if (!Number.isFinite(left)) return;
      window.clearTimeout(early);
      early = window.setTimeout(() => beginOutro(false), Math.max(left, 0));
    };

    video.addEventListener("loadedmetadata", schedule);
    video.addEventListener("timeupdate", schedule);
    if (video.readyState >= 1) schedule(); // metadata zaten geldiyse

    const timer = window.setTimeout(() => {
      // Hâlâ tek kare oynamadıysa beklemeyi kes.
      if (video.currentTime === 0) end();
    }, START_TIMEOUT_MS);

    return () => {
      window.clearTimeout(early);
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", schedule);
      video.removeEventListener("timeupdate", schedule);
    };
  }, [beginOutro, end]);

  // --- karartma + belirme → silinme ----------------------------------------
  useEffect(() => {
    if (phase !== "dimming") return;

    // Form HEMEN açılıyor. Karartma ve formun belirmesi aynı anda başlıyor;
    // film bu sırada son yarım saniyesini altta oynamayı sürdürüyor.
    reveal.current();

    // Katman ancak karartma oturduktan SONRA siliniyor: o an film çoktan
    // son karesinde ve sayfanın arka planı da o kare — geçiş görünmüyor.
    const toGone = window.setTimeout(() => setPhase("gone"), DIM_MS + FADE_MS);
    return () => window.clearTimeout(toGone);
  }, [phase]);

  // --- Esc ile atlama -------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [end]);

  if (phase === "gone") return null;

  return (
    <div
      /*
       * `fixed` — akışın dışında, yani sayfa yerleşimini hiç etkilemiyor
       * (kayma yok). `z-50`: form bunun ÜSTÜNDE (page.tsx, z-60), böylece
       * son yarım saniyede film altta oynarken form belirebiliyor.
       * aria-hidden KONMUYOR, ekran okuyucu formu bu sırada da bulabilsin.
       */
      className={`fixed inset-0 z-50 bg-bg transition-opacity ${FILM_STAGE}`}
      style={{
        opacity: phase === "dimming" ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
        // Silinme, karartma OTURDUKTAN sonra başlasın: iki taraf aynı
        // görüntüyü gösterirken geçiş yapılırsa değişim görünmez.
        transitionDelay: phase === "dimming" ? `${DIM_MS}ms` : "0ms",
      }}
    >
      <video
        ref={videoRef}
        /*
         * `object-cover` + `film-framing`: sayfanın arka planı da aynı kareyi
         * aynı kırpmayla kapladığı için iki görüntü birebir hizalanır.
         * `poster`: video arabelleğe alınırken ekranda siyah kare yerine
         * filmin ilk karesi durur.
         */
        className={`size-full object-cover ${FILM_FRAMING}`}
        poster="/poster-first.jpg"
        preload="auto"
        autoPlay
        muted
        playsInline
        onEnded={end}
        onError={end}
        onPlaying={() => {
          // Film bu sekmede oynadı: yenilemede ve giriş↔kayıt geçişinde
          // bir daha başlamaz. Depo kapalıysa (gizli kip, katı çerez ayarı)
          // film her açılışta oynar — kabul edilebilir, hata değil.
          try {
            sessionStorage.setItem(OPENING_SEEN_KEY, "1");
          } catch {
            /* yok sayılır */
          }
        }}
      >
        <source src="/tracebox-opening.mp4" type="video/mp4" />
      </video>

      {/*
        Karartma. Son kare üstünde 0 → SCRIM'e çıkar; bittiğinde ekrandaki
        görüntü, sayfanın arka planıyla aynı olur.
      */}
      <div
        aria-hidden
        className="absolute inset-0 transition-opacity"
        style={{
          background: SCRIM,
          opacity: phase === "dimming" ? 1 : 0,
          transitionDuration: `${DIM_MS}ms`,
        }}
      />

      {/*
        Atlama. Filmi izlemek isteyen zaten hiçbir şey yapmıyor; girişe gelmiş
        birini 6,8 saniye bekletmemek için çıkış her an açık. Tıklama ya da
        dokunma ile atlanmıyor — kazara tetiklenmesin.

        Buton bu katmanın İÇİNDE; form ise üstünde duruyor (page.tsx, z-60).
        Form belirene kadar `inert` olduğu için isabet testi ona takılmıyor ve
        tıklama buraya ulaşıyor.
      */}
      <button
        type="button"
        onClick={end}
        className="absolute right-5 bottom-5 rounded-lg px-3 py-1.5 text-[13px] text-white/55 transition-opacity hover:text-white/90 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        style={{ opacity: phase === "dimming" ? 0 : 1 }}
      >
        Skip
      </button>
    </div>
  );
}
