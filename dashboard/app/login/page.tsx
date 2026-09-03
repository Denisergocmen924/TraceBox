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
import { FlightRecorderScene } from "./FlightRecorderScene";
import { IconAlert, IconClock, IconKey } from "@/components/icons";

/** Sol sütundaki üç madde. Üçü de ürünün gerçekten yaptığı şeyi anlatıyor. */
const POINTS = [
  {
    icon: IconAlert,
    title: "Ships before the crash",
    body: "The agent flushes immediately when CPU, memory or disk crosses a threshold, and on every error log. Waiting until the machine is down is already too late.",
  },
  {
    icon: IconClock,
    title: "Ten days of timeline",
    body: "A sample every five seconds, kept for ten days, drawn without hiding a single spike. Zoom in far enough and you are looking at the raw numbers the machine sent.",
  },
  {
    icon: IconKey,
    title: "Your rows, and nothing else",
    body: "Every table is guarded by row-level security in Postgres. Your browser talks to the database with your own token; there is no shared read path.",
  },
];

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

  return (
    <div
      data-theme="dark"
      className="min-h-screen bg-bg text-fg selection:bg-accent/30"
    >
      <div className="mx-auto grid min-h-screen max-w-[1240px] items-center gap-12 px-6 py-12 lg:grid-cols-[1.15fr_minmax(360px,0.85fr)] lg:gap-16 lg:py-16">
        {/* --- sol: anlatı + sahne ---------------------------------------- */}
        <section>
          <div className="flex items-center gap-2.5">
            <Image
              src="/tracebox-mark.png"
              alt=""
              width={160}
              height={160}
              priority
              className="size-9 rounded-lg"
            />
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
            TraceBox is a flight recorder for your servers. An agent on each
            machine ships metrics and system logs out while it is still running
            — so when it goes silent, the minutes before are already somewhere
            else.
          </p>

          {/*
            Sahne yalnızca geniş ekranda. Telefonda ilk ekranı bir animasyonla
            doldurup formu katlamanın altına itmek, buraya giriş yapmak için
            gelen kullanıcıyı cezalandırırdı.
          */}
          <div className="mt-10 hidden lg:block">
            <FlightRecorderScene />
          </div>

          <ul className="mt-10 grid gap-6 sm:grid-cols-3">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="size-[18px]" />
                </span>
                <h2 className="mt-3 text-sm font-semibold">{title}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* --- sağ: form --------------------------------------------------- */}
        <section className="w-full">
          <AuthPanel recovery={recovery} />
        </section>
      </div>
    </div>
  );
}
