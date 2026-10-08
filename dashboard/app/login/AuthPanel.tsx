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
 *  2. GitHub / Google ile giriş VAR (eski "OAuth yok" kararı tersine çevrildi).
 *     Ayrıntı ve gerekçe: md/memory/decisions.md. Sağlayıcı listesi tek yerde:
 *     lib/oauthProviders.tsx.
 *
 *  3. Ad / soyad SORULMUYOR.
 *     `accounts` tablosunda böyle bir sütun yok; sormak bir migration ve onu
 *     gösterecek bir yer gerektirirdi. Kullanıcı üst çubukta zaten e-postasıyla
 *     tanınıyor. Kullanmadığımız veriyi toplamamak, gizlilik tarafında da
 *     doğru cevap.
 *
 *  4. ToS YOK.
 *     Uydurma bir "Terms of Service" yazmak, olmayan bir tüzel kişiliğin
 *     sözünü vermek olurdu.
 */
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PasswordInput } from "@/components/PasswordInput";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/lib/oauthProviders";
import { PASSWORD_RULE_HINT, passwordProblem } from "@/lib/password";

type Mode = "signin" | "signup";

const field =
  "mt-2 w-full rounded-md border border-line bg-panel-2 px-3 py-3 text-sm outline-none transition focus:border-accent";

export function AuthPanel({ recovery }: { recovery: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  /*
   * OAuth dönüşü HATALI olabilir: GitHub'da kullanıcı izni reddeder, ya da
   * hesabın e-postası yoktur (Supabase'de "e-postasız kullanıcı"ya izin
   * KAPALI — giriş, hesap silme onayı ve künye e-postaya dayanıyor). Supabase
   * hatayı adres çubuğuna yazar, yani yakalamazsak kullanıcı sebepsiz yere
   * boş bir giriş formuna düşerdi. Sorgu da parça da (#) okunuyor: hangisine
   * yazıldığı akış türüne bağlı.
   */
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash.replace(/^#/, "") || window.location.search,
    );
    const description = params.get("error_description");
    if (!description) return;
    setError(description.replace(/\+/g, " "));
    // Adresi temizle: yenilenince aynı hata yeniden çıkmasın.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function signInWithProvider(provider: OAuthProviderId) {
    setBusy(true);
    setError(null);
    setNotice(null);
    // Başarılıysa tarayıcı sağlayıcıya gider ve sayfa terk edilir; busy'yi geri
    // açmaya gerek yok. Dönüşte /login'e inilir, oturum varsa sayfa kullanıcıyı
    // içeri alır (app/login/page.tsx).
    const { error } = await supabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

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
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        setBusy(false);
        return;
      }
      const { error } = await supabase().auth.updateUser({ password });
      if (error) setError(error.message);
      else setNotice("Password updated. Taking you to your hosts…");
      setBusy(false);
      return;
    }

    /* --- kayıt --------------------------------------------------------- */
    if (mode === "signup") {
      // Giriş kipinde kural YOK: eski, daha zayıf şifreli hesaplar girebilmeli.
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        setBusy(false);
        return;
      }
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
        <PasswordInput
          id="new-password"
          name="new-password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          wrapperClassName="mt-2"
        />
        <p className="mt-1.5 text-xs text-faint">{PASSWORD_RULE_HINT}</p>

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="mt-4 text-sm text-ok">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-md bg-accent px-3 py-3 font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
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

        {/* --- sağlayıcı ile giriş ------------------------------------------
            Kayıt ve giriş için AYNI düğme: sağlayıcı hesabıyla ilk girişte Supabase hesabı
            oluşturur. İki kipte ayrı düğme olması kullanıcıya olmayan bir
            fark anlatırdı. */}
        <div className="mt-6 space-y-2.5">
          {OAUTH_PROVIDERS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => signInWithProvider(id)}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2.5 rounded-md border border-line bg-panel-2 px-3 py-3 text-sm font-medium transition hover:border-accent disabled:opacity-50"
            >
              <Icon className="size-[18px]" />
              Continue with {label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <label className="mt-5 block text-sm text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
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
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete={
            mode === "signup" ? "new-password" : "current-password"
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          wrapperClassName="mt-2"
        />
        {mode === "signup" && (
          <p className="mt-1.5 text-xs text-faint">{PASSWORD_RULE_HINT}</p>
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
          className="mt-6 w-full rounded-md bg-accent px-3 py-3 font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
        >
          {busy
            ? mode === "signup"
              ? "Creating…"
              : "Signing in…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
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
