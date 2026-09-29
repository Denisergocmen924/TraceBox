/**
 * Ekran 1 — giriş / kayıt vitrini (CLAUDE.md §9.12).
 *
 * Bu dosya, M9 boyunca yerini tutan süssüz formun yerini alıyor. §9.2'nin
 * kuralı buydu: tesisat önden çalışsın, vitrin en sonda yapılsın.
 *
 * Ekran aynı zamanda REKLAM PANOSU — bir IaaS ürününü, onu hiç duymamış birine
 * anlatan tek yer. Solda anlatı + kara kutu sahnesi, sağda form (§9.12'nin iki
 * panel kurgusu).
 *
 * TEMA: burası zorla KOYU. §9.11.2 uygulamanın varsayılanını açığa çevirdi ama
 * landing'i dışarıda tuttu — marka kimliği koyu lacivert zemin ve elektrik mavisi
 * vurgu üstüne kurulu (§9.11). Koyuluk, sarmalayıcı bir `div`e konan
 * `data-theme="dark"` ile geliyor: globals.css'te seçici `[data-theme="dark"]`,
 * yani `:root`a bağlı DEĞİL — herhangi bir alt ağaç kendi temasını seçebilir.
 * `<html>`e yazmak ThemeProvider ile kavga eder ve kullanıcı içeri girdiğinde
 * seçimi bozulmuş olurdu.
 */
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { AuthPanel } from "./AuthPanel";
import {
  FILM_BACKDROP,
  FILM_FRAMING,
  OPENING_SEEN_KEY,
  OpeningSequence,
  SCRIM,
} from "./OpeningSequence";

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();

  /*
   * Şifre kurtarma bağlantısı da bir OTURUM açar. Bu yüzden "oturum varsa
   * içeri al" kuralı burada olduğu gibi uygulanamaz: kullanıcı yeni şifresini
   * seçemeden Overview'a fırlatılırdı.
   *
   * İki yoldan da tespit ediliyor. Başlangıç değeri adresteki `type=recovery`
   * parçasını SENKRON okuyor — Supabase olayı ulaşana kadar geçen birkaç
   * milisaniyede yönlendirmenin tetiklenmemesi için. Dinleyici ise asıl
   * doğrulama: parça temizlenmiş olsa bile olay gelir.
   */
  const [recovery, setRecovery] = useState(
    () =>
      typeof window !== "undefined" &&
      window.location.hash.includes("type=recovery"),
  );

  useEffect(() => {
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      // Yeni şifre kaydedilince Supabase USER_UPDATED yollar; kurtarma kipi
      // burada biter ve aşağıdaki yönlendirme kullanıcıyı içeri alır.
      if (event === "USER_UPDATED") setRecovery(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // "Bilmiyorum" hâlinde yönlendirme yok (useSession'ın üç ayrı durumu).
    if (status === "signedIn" && !recovery) router.replace("/overview");
  }, [status, recovery, router]);

  /*
   * AÇILIŞ FİLMİ — iki ayrı soru, iki ayrı state.
   *
   * `opening`: film oynayacak mı? "unknown" hâli bilinçli — oturum durumu
   * çözülmeden karar verilemez, çünkü oturumu olan kullanıcı bu sayfada
   * kalmayacak ve filmin ilk karelerini bile görmemeli.
   *
   * `revealed`: giriş ekranı göründü mü? Filmden BAĞIMSIZ: film hiç oynamasa
   * da, hata verse de, atlansa da bu bayrak açılır. Formun görünürlüğü hiçbir
   * koşulda videoya bağlanmıyor.
   */
  const [opening, setOpening] = useState<"unknown" | "play" | "skip">(
    "unknown",
  );
  const [revealed, setRevealed] = useState(false);

  /*
   * Logo sallanması — saf bir tıklama şekeri. `logoShaking` true iken animasyon
   * oynuyor; süresi dolunca `onAnimationEnd` kendisi false'a çeker, ayrı bir
   * zamanlayıcıya gerek yok. Animasyon oynarken tıklama yok sayılıyor —
   * state zaten true olduğu için ikinci bir tıklama sınıfı DEĞİŞTİRMEZ, yani
   * CSS animasyonu yeniden başlamaz; en basit çözüm animasyon bitene kadar
   * tıklamayı görmezden gelmek.
   */
  const [logoShaking, setLogoShaking] = useState(false);

  useEffect(() => {
    if (opening !== "unknown") return; // karar bir kez verilir
    if (status === "loading") return; // henüz bilmiyoruz
    // Oturumu olan kullanıcı /overview'a gidiyor; ona hiçbir şey gösterilmez.
    if (status === "signedIn" && !recovery) return;

    // Hareket azaltma tercihi MUTLAK — erişilebilirlik sinematik deneyimin
    // önünde gelir.
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Film bu sekmede oynadıysa bir daha oynamaz. Depo kapalıysa okuma
    // patlar; o hâlde "izlenmedi" sayılır ve film oynar.
    let seen = false;
    try {
      seen = sessionStorage.getItem(OPENING_SEEN_KEY) === "1";
    } catch {
      /* yok sayılır */
    }

    /*
     * Dar alan artık bir ELEME SEBEBİ DEĞİL. Telefon da aynı dosyayı aynı
     * tam ekran akışla oynatır; kompozisyon `film-framing` ile korunur
     * (globals.css). Dosya 1,15 MB — mobil bant genişliği için de kabul
     * edilebilir bir yük.
     */

    // Şifre kurtarma bağlantısıyla gelen kullanıcı bir işi bitirmeye geldi,
    // film izlemeye değil.
    if (reduced || seen || recovery) {
      setOpening("skip");
      setRevealed(true);
    } else {
      setOpening("play");
    }
  }, [status, recovery, opening]);

  /*
   * SON EMNİYET — giriş ekranı hiçbir koşulda kilitli kalmaz.
   *
   * Yukarıdaki karar `status`a bağlı ve `status` çözülmeyebilir: Supabase
   * adresi yanlışsa ya da ağ kopuksa `useSession` "loading" hâlinde asılı
   * kalır. O hâlde `opening` "unknown", form da görünmez ve `inert` olurdu —
   * kullanıcı siyah bir ekrana bakar, girişe hiç ulaşamazdı.
   *
   * Bu zamanlayıcı filmle ilgili DEĞİL: film bir kez başladıysa kendi bitişi
   * (6,8 sn + karartma) bundan önce gelir ve `opening` çoktan "play" olmuştur.
   */
  useEffect(() => {
    if (opening !== "unknown") return;

    const timer = window.setTimeout(() => {
      setOpening("skip");
      setRevealed(true);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [opening]);

  return (
    <div
      data-theme="dark"
      className="relative min-h-screen bg-bg text-fg selection:bg-accent/30"
    >
      {/*
        ARKA PLAN — filmin SON KARESİ. Katman `fixed`: akışın dışında olduğu
        için sayfa yerleşimini hiç etkilemiyor (kayma yok). Film oynarken
        üstünü OpeningSequence kapatıyor; o katman silindiğinde altından çıkan
        görüntü donan karenin aynısı oluyor — geçiş bu yüzden görünmez.
      */}
      <div
        aria-hidden
        className={`fixed inset-0 bg-cover bg-no-repeat transition-opacity duration-700 ${FILM_FRAMING} ${FILM_BACKDROP}`}
        style={{
          backgroundImage: "url(/poster-last.jpg)",
          /*
           * Oturum durumu çözülene kadar arka plan da yok. Karar "film
           * oynasın" çıkacaksa kullanıcı önce SON kareyi görüp sonra filmin
           * BAŞINA dönmüş olmamalı.
           */
          opacity: opening === "unknown" ? 0 : 1,
        }}
      />
      {/* Karartma. OpeningSequence'teki karartmayla AYNI değer (SCRIM). */}
      <div aria-hidden className="fixed inset-0" style={{ background: SCRIM }} />

      <div
        /*
         * Form filmi BEKLEMİYOR: DOM'da, kurulu ve hazır; yalnızca görünmez
         * ve `inert` ile dokunulmaz. `inert` olmasaydı sekme tuşu filmin
         * arkasındaki alanlara düşerdi.
         *
         * `z-60` film katmanının (z-50) ÜSTÜNE alıyor: film bitişine yarım
         * saniye kala form belirmeye başlıyor ve o sırada altta oynamaya
         * devam ediyor. Görünmezken `inert` olduğu için isabet testi buraya
         * takılmıyor — filmin "Skip" butonu tıklanabilir kalıyor.
         */
        inert={!revealed}
        className="relative z-60 mx-auto grid min-h-screen max-w-[1240px] items-center gap-12 px-6 py-12 transition-opacity duration-700 lg:grid-cols-[1.15fr_minmax(360px,0.85fr)] lg:gap-16 lg:py-16"
        style={{ opacity: revealed ? 1 : 0 }}
      >
        {/* --- sol: anlatı + sahne ---------------------------------------- */}
        <section>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="TraceBox"
              onClick={() => {
                if (!logoShaking) setLogoShaking(true);
              }}
              onAnimationEnd={() => setLogoShaking(false)}
              className={`size-12 shrink-0 ${logoShaking ? "logo-shake" : ""}`}
            >
              <Image
                src="/tracebox-mark.png"
                alt=""
                width={160}
                height={160}
                priority
                className="size-12"
              />
            </button>
            <span className="text-[19px] font-semibold tracking-tight">
              TraceBox
            </span>
          </div>

          <h1 className="mt-8 max-w-xl text-4xl leading-[1.12] font-semibold tracking-tight sm:text-5xl">
            The last thing your machine said,
            <br />
            kept where the crash can&apos;t reach.
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            TraceBox is a flight recorder for your devices. An agent on each
            machine ships metrics and system logs out while it is still running
            — so when it goes silent, the minutes before are already somewhere
            else.
          </p>
        </section>

        {/* --- sağ: form --------------------------------------------------- */}
        <section className="w-full">
          <AuthPanel recovery={recovery} />
        </section>
      </div>

      {/*
        Film. Yalnızca kararı verilmişse takılıyor ve işi bitince kendini
        DOM'dan çıkarıyor. Tek çıktısı `onReveal` — "karartma oturdu, giriş
        ekranı artık belirebilir".
      */}
      {opening === "play" && (
        <OpeningSequence onReveal={() => setRevealed(true)} />
      )}
    </div>
  );
}
