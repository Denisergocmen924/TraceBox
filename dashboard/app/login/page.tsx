/**
 * Ekran 1 — GEÇİCİ giriş formu (CLAUDE.md §9.2).
 *
 * Bilerek süssüz. §9.12'deki kara kutu animasyonlu vitrin EN SON yapılacak;
 * bu dosya o zaman baştan yazılır. Buradaki tek iş, altındaki tesisatın
 * (Supabase Auth → oturum → RLS'li okuma) gerçekten çalıştığını kanıtlamak.
 *
 * KAYIT (sign-up) EKRANI YOK — karar §9.2'de kilitli. İlk hesap Supabase
 * panelinden elle açılır. Kayıt akışı vitrinle birlikte tasarlanacak
 * ([[pending]] #10, #11, #12).
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Giriş yapmış biri giriş ekranını görmemeli.
  useEffect(() => {
    if (status === "signedIn") router.replace("/devices");
  }, [status, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabase().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Supabase "e-posta yanlış" ile "şifre yanlış"ı bilerek AYIRMAZ; ayırsaydı
      // form bir hesap-var-mı sorgusuna dönerdi. Türkçe karşılığı da aynı
      // belirsizliği korur.
      setError(
        error.message === "Invalid login credentials"
          ? "E-posta veya şifre hatalı."
          : error.message,
      );
      setBusy(false);
      return;
    }
    // Başarılıysa yönlendirmeyi yukarıdaki useEffect yapar (oturum değişince).
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">TraceBox</h1>
          <p className="mt-2 text-sm text-muted">
            Devam etmek için giriş yapın.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-line bg-panel p-6"
        >
          <label className="block text-sm text-muted" htmlFor="email">
            E-posta
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 outline-none focus:border-accent"
          />

          <label
            className="mt-5 block text-sm text-muted"
            htmlFor="password"
          >
            Şifre
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 outline-none focus:border-accent"
          />

          {error && (
            <p className="mt-4 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-lg bg-accent px-3 py-2 font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? "Giriş yapılıyor…" : "Giriş yap"}
          </button>
        </form>
      </div>
    </main>
  );
}
