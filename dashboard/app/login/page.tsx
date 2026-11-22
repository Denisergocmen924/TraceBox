/**
 * Ekran 1 — giriş / kayıt vitrini (CLAUDE.md §9.12).
 *
 * Bu dosya, M9 boyunca yerini tutan süssüz formun yerini alıyor. §9.2'nin
 * kuralı buydu: tesisat önden çalışsın, vitrin en sonda yapılsın.
 *
 * Ekran aynı zamanda REKLAM PANOSU — bir IaaS ürününü, onu hiç duymamış birine
 * anlatan tek yer. Solda anlatı, sağda form (§9.12'nin iki
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
   * Logo sallanması — saf bir tıklama şekeri. `logoShaking` true iken animasyon
   * oynuyor; süresi dolunca `onAnimationEnd` kendisi false'a çeker, ayrı bir
   * zamanlayıcıya gerek yok. Animasyon oynarken tıklama yok sayılıyor —
   * state zaten true olduğu için ikinci bir tıklama sınıfı DEĞİŞTİRMEZ, yani
   * CSS animasyonu yeniden başlamaz; en basit çözüm animasyon bitene kadar
   * tıklamayı görmezden gelmek.
   */
  const [logoShaking, setLogoShaking] = useState(false);

  return (
    <div
      data-theme="dark"
      className="relative min-h-screen bg-bg text-fg selection:bg-accent/30"
    >
      <div className="relative mx-auto grid min-h-screen max-w-[1240px] items-center gap-12 px-6 py-12 lg:grid-cols-[1.15fr_minmax(360px,0.85fr)] lg:gap-16 lg:py-16">
        {/* --- sol: anlatı ---------------------------------------------- */}
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
    </div>
  );
}
