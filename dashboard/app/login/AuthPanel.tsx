/**
 * Vitrinin sağ paneli: giriş, kayıt ve şifre sıfırlama (CLAUDE.md §9.12).
 *
 * Bu dosya §9.13'te açık bırakılan üç noktayı kapatıyor. Kararlar ve
 * gerekçeleri:
 *
 *  1. KAYIT AÇIK, e-posta doğrulaması ZORUNLU (davetli değil).
 *     Davetli bir kapı, akışın kendisini gösterilmeden bırakırdı — oysa bu bir
 *     portföy projesi ve onboarding tam da gösterilmesi gereken parça. Açık
 *     kapının riski maliyet (Free planda 500 MB); doğrulama bunun en ucuz
 *     freni, çünkü bir bot bağlantıya tıklayamıyor. Supabase panelinde
 *     "Confirm email" AÇIK olmalı — kapalıyken bu ekran yine çalışır ama fren
 *     kalkmış olur.
 *
 *  2. GitHub / Google ile giriş YOK.
 *     Her sağlayıcı ortam başına bir OAuth uygulaması, bir yönlendirme adresi
 *     ve bir sır demek — üç deploy adımı karşılığında sıfır yeni yetenek.
 *     Sonradan eklenmesi tek bir `signInWithOAuth` çağrısı; bugün eklemek,
 *     kurulumu bağlamak.
 *
 *  3. Ad / soyad SORULMUYOR.
 *     `accounts` tablosunda böyle bir sütun yok; sormak bir migration ve onu
 *     gösterecek bir yer gerektirirdi. Kullanıcı üst çubukta zaten e-postasıyla
 *     tanınıyor. Kullanmadığımız veriyi toplamamak, gizlilik tarafında da
 *     doğru cevap.
 *
 *  4. ToS YOK, gizlilik NOTU var.
 *     Uydurma bir "Terms of Service" yazmak, olmayan bir tüzel kişiliğin
 *     sözünü vermek olurdu. Buna karşılık ürün gerçek makine telemetrisi
 *     topluyor; ne sakladığını ve ne kadar süreyle sakladığını söylemek
 *     zorunda. Formun altındaki tek cümle bunu yapıyor ve söylediği şey
 *     `accounts.retention_days` ile birebir aynı.
 */
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Mode = "signin" | "signup";

/** Supabase'in varsayılan alt sınırı 6; kayıt olurken 8 istiyoruz. */
const MIN_PASSWORD = 8;

const field =
  "mt-2 w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm outline-none transition focus:border-accent";

export function AuthPanel({ recovery }: { recovery: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    /* --- kurtarma: yeni şifreyi belirle ------------------------------- */
    if (recovery) {
      const { error } = await supabase().auth.updateUser({ password });
      if (error) setError(error.message);
      else setNotice("Password updated. Taking you to your hosts…");
      setBusy(false);
      return;
    }

    /* --- kayıt --------------------------------------------------------- */
    if (mode === "signup") {
      const { error } = await supabase().auth.signUp({
        email,
        password,
        options: {
          // Doğrulama bağlantısı buraya döner; oturum açılınca kök adres
          // kullanıcıyı Overview'a gönderir.
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) {
        setError(error.message);
      } else {
        /*
         * Mesaj, e-postanın kayıtlı OLUP OLMADIĞINI söylemiyor. Supabase de
         * bu yüzden zaten var olan bir adres için hata döndürmüyor: aksi
         * hâlde form, "bu kişinin hesabı var mı" sorusunu herkese açık bir
         * sorgulama aracına dönüşürdü.
         */
        setNotice(
          `If ${email} can be registered, a confirmation link is on its way. Open it to finish creating your account.`,
        );
        setPassword("");
      }
      setBusy(false);
      return;
    }

    /* --- giriş --------------------------------------------------------- */
    const { error } = await supabase().auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      // Supabase "e-posta yanlış" ile "şifre yanlış"ı bilerek AYIRMAZ; ayırsaydı
      // form bir hesap-var-mı sorgusuna dönerdi. Karşılığı da aynı belirsizliği
      // koruyor.
      setError(
        error.message === "Invalid login credentials"
          ? "Incorrect email or password."
          : error.message,
      );
      setBusy(false);
      return;
    }
    // Başarılıysa yönlendirmeyi sayfa yapar (oturum değişince).
  }

  async function sendReset() {
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setBusy(false);
    setResetting(false);
    if (error) setError(error.message);
    else
      setNotice(
        `If ${email} has an account, a reset link is on its way. The link signs you in once so you can pick a new password.`,
      );
  }

  /* --- kurtarma kipi: tek alanlı ayrı bir form -------------------------- */
  if (recovery) {
    return (
      <form
        onSubmit={onSubmit}
        className="rounded-card border border-line bg-panel p-6 shadow-card"
      >
        <h2 className="text-lg font-semibold">Set a new password</h2>
        <p className="mt-1 text-sm text-muted">
          You opened a reset link, so you are signed in for this one step.
        </p>

        <label className="mt-6 block text-sm text-muted" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        <p className="mt-1.5 text-xs text-faint">
          At least {MIN_PASSWORD} characters.
        </p>

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="mt-4 text-sm text-ok">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-accent px-3 py-2.5 font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    );
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="rounded-card border border-line bg-panel p-6 shadow-card"
      >
        {/* --- kip seçici --------------------------------------------------
            İki sekme, iki ayrı sayfa değil: kayıt ile giriş arasında gidip
            gelmek tek tık, yazılan e-posta da yerinde kalıyor. */}
        <div className="flex rounded-lg border border-line bg-bg-soft p-0.5">
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                mode === m ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <label className="mt-6 block text-sm text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />

        <div className="mt-5 flex items-baseline justify-between gap-3">
          <label className="block text-sm text-muted" htmlFor="password">
            Password
          </label>
          {mode === "signin" && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
                setResetting(true);
              }}
              /* E-posta yazılmadan sıfırlama isteği gönderilemez: boş bir
                 adrese giden istek sessizce hiçbir şey yapmaz ve kullanıcı
                 gelmeyen bir postayı beklerdi. */
              disabled={!email}
              className="text-xs text-muted underline-offset-4 transition hover:text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline"
            >
              Forgot password?
            </button>
          )}
        </div>
        <input
          id="password"
          type="password"
          required
          minLength={mode === "signup" ? MIN_PASSWORD : undefined}
          autoComplete={
            mode === "signup" ? "new-password" : "current-password"
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        {mode === "signup" && (
          <p className="mt-1.5 text-xs text-faint">
            At least {MIN_PASSWORD} characters.
          </p>
        )}

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-4 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2.5 text-sm text-ok">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-accent px-3 py-2.5 font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
        >
          {busy
            ? mode === "signup"
              ? "Creating…"
              : "Signing in…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>

        {/*
          Gizlilik notu — uydurma bir sözleşme değil, ne sakladığımızın tek
          cümlelik doğrusu. On gün, `accounts.retention_days`ın varsayılanı;
          silme işini pg_cron her gece kendisi yapıyor (db/retention.sql).
        */}
        <p className="mt-5 text-xs leading-relaxed text-faint">
          TraceBox stores the metrics and logs shipped by the hosts you connect
          for 10 days, then deletes them automatically. Nothing else about you
          is collected.
        </p>
      </form>

      {/*
        §9.10 — şifre sıfırlama da bir onay penceresi ister, AMA "geri
        alınamaz" DEMEZ. Oradaki doğru cümle "mevcut şifren geçersiz olacak":
        pencere var, metin gerçeği söylüyor.
      */}
      {resetting && (
        <ConfirmDialog
          title="Send a reset link?"
          warning="Your current password stops working as soon as you set a new one."
          confirmLabel="Send link"
          busy={busy}
          onConfirm={sendReset}
          onCancel={() => setResetting(false)}
        >
          <p>
            We will email a one-time link to{" "}
            <span className="font-medium text-fg">{email}</span>. Opening it
            signs you in just long enough to choose a new password.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
