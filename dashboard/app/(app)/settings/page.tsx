/**
 * Settings — kenar çubuğundaki "Settings" bölümünün sayfası.
 *
 * Burada DÜZENLENEBİLİR alan neredeyse yok ve bu bir eksiklik değil, §2'nin
 * "config = insan sınırı, policy = sistem sınırı" ayrımının doğrudan sonucu:
 *
 *   - Toplama aralıkları, eşikler, spool sınırları → CONFIG. İnsan sınırı ama
 *     o insan makinenin sahibi ve ayar makinede duruyor (/etc/tracebox/config.toml,
 *     §4.3). Dashboard'dan yazılamaz — yazılabilseydi tek yazar kuralı kırılır,
 *     agent'ın diskteki dosyası ile bulutun kopyası ayrışırdı.
 *   - Saklama süresi ve plan → POLICY. Sistem sınırı; kullanıcı kendi faturasını
 *     kendi büyütemesin diye salt okunur.
 *   - Tema → gerçekten kullanıcının, gerçekten burada.
 *
 * Bu yüzden sayfa bir form değil, bir KÜNYE: hangi ayarın nerede yaşadığını ve
 * neden orada olduğunu söylüyor. Söylemeseydi kullanıcı düzenlenemeyen alanlara
 * bakıp arayüzün yarım kaldığını sanırdı.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/appState";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/useSession";
import { fetchAccount, type Account } from "@/lib/account";
import { supabase } from "@/lib/supabase";
import { deleteAccount } from "@/lib/collector";
import { localDateTime } from "@/lib/time";
import { errorMessage } from "@/lib/errors";
import { PASSWORD_RULE_HINT, passwordProblem } from "@/lib/password";
import { OAUTH_PROVIDERS, providerLabel, type OAuthProviderId } from "@/lib/oauthProviders";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PasswordInput } from "@/components/PasswordInput";
import type { UserIdentity } from "@supabase/supabase-js";
import { IconMoon, IconSun, IconTrash } from "@/components/icons";

/** Künye satırı: solda etiket + gerekçe, sağda değer. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 border-b border-line px-4 sm:px-5 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 max-w-lg text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0 text-sm">{children}</div>
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
      <div className="border-b border-line px-4 sm:px-5 py-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Salt okunur, seçilebilir teknik değer (UUID, URL). */
function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-panel-2 px-2 py-1 font-mono text-xs text-muted select-all">
      {children}
    </code>
  );
}

export default function SettingsPage() {
  const { email, accountId, devices } = useApp();
  const { theme, setTheme } = useTheme();

  // Kimlikler Supabase'den okunur (`user_identities`): oturum jetonundaki
  // app_metadata bağlama/çözmeden sonra bayat kalır, bu liste her çağrıda taze.
  // Şifre yalnızca "email" kimliği olan hesapta var: yalnızca GitHub ile girmiş
  // birinin değiştirecek şifresi yoktur; birleşmiş hesapta "email" de listede
  // olduğu için düğme çıkar.
  const { session } = useSession();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [identError, setIdentError] = useState<string | null>(null);
  const [identBusy, setIdentBusy] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<UserIdentity | null>(null);

  const loadIdentities = useCallback(async () => {
    const { data, error } = await supabase().auth.getUserIdentities();
    if (error) setIdentError(error.message);
    else setIdentities(data.identities);
  }, []);

  useEffect(() => {
    // Bağlama GitHub'a gidip /settings'e DÖNEREK biter; hata (ör. o GitHub
    // hesabı başka bir kullanıcıya bağlı) adres çubuğunda gelir.
    const params = new URLSearchParams(
      window.location.hash.replace(/^#/, "") || window.location.search,
    );
    const description = params.get("error_description");
    if (description) {
      setIdentError(description.replace(/\+/g, " "));
      window.history.replaceState(null, "", window.location.pathname);
    }
    void loadIdentities();
  }, [loadIdentities]);

  const providers = (session?.user.app_metadata?.providers as string[] | undefined) ?? [];
  const hasPassword = identities
    ? identities.some((i) => i.provider === "email")
    : providers.includes("email");

  // Şifresiz hesapta "GitHub", "Google" ya da "GitHub and Google".
  const signInNames =
    (identities ?? [])
      .map((i) => providerLabel(i.provider))
      .join(" and ") || "your provider";

  async function handleLink(provider: OAuthProviderId) {
    setIdentBusy(provider);
    setIdentError(null);
    // Başarılıysa tarayıcı sağlayıcıya gider; busy'yi açmaya gerek yok.
    const { error } = await supabase().auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/settings` },
    });
    if (error) {
      setIdentError(error.message);
      setIdentBusy(null);
    }
  }

  async function handleUnlink() {
    if (!unlinkTarget) return;
    setIdentBusy(unlinkTarget.provider);
    setIdentError(null);
    const { error } = await supabase().auth.unlinkIdentity(unlinkTarget);
    setUnlinkTarget(null);
    setIdentBusy(null);
    if (error) setIdentError(error.message);
    else await loadIdentities();
  }

  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hesap silme — sayfanın geri kalanından AYRI durum: dialog'un kendi
  // busy/error'ı var, çünkü bu tek işlem başarısız olsa bile üstteki `error`
  // (hesap satırı okunamadı) mesajıyla karışmamalı.
  // İki aşamalı onay (§9.10): "type" → cümle yazdırılır, "final" → son "emin misin".
  // null = pencere kapalı. Silme yalnızca "final" aşamasında tetiklenir.
  const [deleteStep, setDeleteStep] = useState<"type" | "final" | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      // Sunucudaki satır gitti; yerel oturumu da temizle. Yönlendirme burada
      // EXPLICIT yapılmıyor — app/(app)/layout.tsx zaten `signedOut`
      // durumunu dinleyip /login'e atıyor (bkz. lib/useSession.ts).
      await supabase().auth.signOut();
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleteBusy(false);
    }
  }

  // Şifre değiştirme — oturum AÇIKKEN (giriş ekranındaki e-posta bağlantılı
  // kurtarma akışından ayrı bir giriş noktası). Alanlar sayfada, onay pencere
  // olarak: form yanlışlıkla submit edilirse şifre hemen değişmesin.
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [repeatPw, setRepeatPw] = useState("");
  const [pwFormError, setPwFormError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  // null = kapalı · "form" = alanlar penceresi · "confirm" = §9.10 onayı.
  // Aynı anda tek pencere: ConfirmDialog Enter'ı iptal sayar, altta bir form
  // açık kalsaydı Enter iki pencereyi birden çatıştırırdı.
  const [pwStep, setPwStep] = useState<"form" | "confirm" | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwNotice(null);
    // Kural ihlalleri pencereyi hiç açmaz: kullanıcıyı boşuna "emin misin"
    // aşamasına sokup orada reddetmek kötü bir sıra olurdu.
    const problem = passwordProblem(newPw);
    if (problem) {
      setPwFormError(problem);
    } else if (newPw !== repeatPw) {
      setPwFormError("The two new passwords do not match.");
    } else if (newPw === currentPw) {
      setPwFormError("The new password must differ from the current one.");
    } else {
      setPwFormError(null);
      setPwError(null);
      setPwStep("confirm");
    }
  }

  async function handleChangePassword() {
    setPwBusy(true);
    setPwError(null);
    try {
      // Önce mevcut şifreyi KANITLAT. `updateUser` açık bir oturumla yeni
      // şifreyi mevcut şifreyi sormadan da kabul eder; yani açık kalmış bir
      // tarayıcıya erişen biri hesabı kalıcı olarak ele geçirebilirdi.
      const { error: verifyError } = await supabase().auth.signInWithPassword({
        email,
        password: currentPw,
      });
      if (verifyError) {
        // Giriş ekranındaki aynı çeviri: Supabase'in ham mesajı yanıltıcı.
        throw new Error(
          verifyError.message === "Invalid login credentials"
            ? "Your current password is incorrect."
            : verifyError.message,
        );
      }
      const { error } = await supabase().auth.updateUser({ password: newPw });
      if (error) throw error;
      setCurrentPw("");
      setNewPw("");
      setRepeatPw("");
      setPwStep(null);
      setPwNotice("Password updated.");
    } catch (e) {
      setPwError(errorMessage(e));
    } finally {
      setPwBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchAccount()
      .then((data) => !cancelled && setAccount(data))
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Settings"
        description="Your account, and where each setting actually lives."
      />

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read the account row: {error}
        </p>
      )}

      <div className="space-y-6">
        {/* --- hesap --------------------------------------------------- */}
        <Card
          title="Account"
          description="Identity comes from Supabase Auth; the row below is what TraceBox stores next to it."
        >
          <Row label="Email">
            <span className="font-medium">{email}</span>
          </Row>
          <Row
            label="Account ID"
            hint="Also your user ID — every row you can read carries it, and that is what row-level security matches on."
          >
            <Mono>{accountId}</Mono>
          </Row>
          <Row label="Plan">
            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent uppercase">
              {account?.plan ?? "—"}
            </span>
          </Row>
          <Row label="Member since">
            <span className="tabular-nums text-muted">
              {account ? localDateTime(account.created_at) : "—"}
            </span>
          </Row>
          <Row label="Hosts">
            <span className="tabular-nums text-muted">
              {devices ? devices.length : "—"}
            </span>
          </Row>
        </Card>

        {/* --- policy -------------------------------------------------- */}
        <Card
          title="Retention"
          description="A policy, not a preference — this one is deliberately read-only."
        >
          <Row
            label="History kept"
            hint="Metrics, logs and crash snapshots older than this are deleted every night at 00:00 UTC. The cut-off uses the time the collector received a row, never the timestamp the device wrote — otherwise a host with a wrong clock could keep its data forever."
          >
            <span className="text-lg font-semibold tabular-nums">
              {account ? `${account.retention_days} days` : "—"}
            </span>
          </Row>
          <div className="bg-bg-soft px-4 sm:px-5 py-4">
            <p className="text-xs leading-relaxed text-muted">
              TraceBox is a black box, not an archive: it answers{" "}
              <span className="text-fg">what happened just before this
              machine went down</span>, and that question has a short shelf
              life. Letting each account extend its own window would quietly
              turn a fixed storage bill into an open-ended one, so the window is
              set by the system rather than by you.
            </p>
          </div>
        </Card>

        {/* --- agent tarafındaki ayarlar -------------------------------- */}
        <Card
          title="Agent configuration"
          description="These live on each machine, and only there."
        >
          <div className="px-4 sm:px-5 py-4">
            <p className="text-xs leading-relaxed text-muted">
              Collection interval, send interval, flush thresholds and spool
              limits are read from{" "}
              <Mono>/etc/tracebox/config.toml</Mono> on the host itself. The
              agent re-reads that file on every tick, so an edit takes effect
              without a restart — and no restart is needed here either, because
              the dashboard never writes it.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Keeping it one-way is what makes the agent trustworthy while
              offline: the machine&rsquo;s own file is the only source of truth
              for how it behaves, whether or not it can reach the cloud. What
              the dashboard <span className="text-fg">can</span> do is queue a
              command — pause, resume or delete — which the agent picks up on
              its next poll. Those buttons are on each host&rsquo;s own page.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              <span className="text-fg">Disk is the one threshold that does not
              repeat.</span>{" "}
              CPU and memory flush again and again while they stay high, because
              nobody can tell when a crash will land. A disk does not swing like
              that, so it flushes once when it first passes its threshold and
              then only when usage climbs another step (
              <Mono>disk_flush_step_percent</Mono>, 0.1 points by default). It
              re-arms once usage falls a point below the threshold. Edit the step
              in that host&rsquo;s own <Mono>config.toml</Mono>. The red disk
              warning on the Hosts and Alerts pages does not depend on any of
              this — it stays for as long as the disk is over the threshold.
            </p>
          </div>
        </Card>

        {/* --- görünüm -------------------------------------------------- */}
        <Card
          title="Appearance"
          description="Stored in this browser only; there is no server-side copy."
        >
          <Row
            label="Theme"
            hint="Applied before the first paint, so switching never flashes the other theme."
          >
            <div className="flex overflow-hidden rounded-md border border-line">
              {(
                [
                  { value: "light", label: "Light", Icon: IconSun },
                  { value: "dark", label: "Dark", Icon: IconMoon },
                ] as const
              ).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                  className={`flex items-center gap-2 px-3.5 py-2.5 text-sm transition ${
                    theme === value
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-panel-2 hover:text-fg"
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </Row>
        </Card>

        {/* --- bağlı hesaplar ------------------------------------------- */}
        <Card
          title="Connected accounts"
          description="Sign-in methods linked to this TraceBox account. Any linked method opens the same account and the same hosts."
        >
          {/* Unlink yalnızca TraceBox'taki bağlantıyı siler; sağlayıcıdaki izin
              (grant) onda kalır. Bu HER OAuth sağlayıcısı için geçerli, o yüzden
              not satır başına değil kartın başında. */}
          <p className="border-b border-line px-4 sm:px-5 py-3 text-xs text-danger/80">
            Unlinking only removes the connection on TraceBox. To fully revoke access, also
            remove TraceBox from the provider&apos;s own settings. Signing in again with the
            same verified email links it back automatically.
          </p>
          {OAUTH_PROVIDERS.map(({ id, label, Icon }) => {
            const identity = identities?.find((i) => i.provider === id);
            // Son kimlik çözülemez: hesaba girişin tek yolu kalmaz. Supabase de
            // reddeder; düğmeyi hiç göstermemek hata mesajından iyidir.
            const canUnlink = !!identities && identities.length > 1;
            const email = identity?.identity_data?.email as string | undefined;
            return (
              <Row
                key={id}
                label={label}
                hint={
                  identity
                    ? `Linked${email ? ` as ${email}` : ""}.`
                    : identities
                      ? "Not linked. Linking lets you sign in with this provider as well."
                      : "Loading…"
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="size-[18px] text-muted" />
                  {identity ? (
                    <button
                      onClick={() => setUnlinkTarget(identity)}
                      disabled={!canUnlink || identBusy !== null}
                      title={canUnlink ? undefined : "This is your only sign-in method."}
                      className="rounded-md border border-line bg-panel px-3.5 py-2.5 text-sm text-muted transition hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-muted"
                    >
                      Unlink
                    </button>
                  ) : (
                    <button
                      onClick={() => handleLink(id)}
                      disabled={!identities || identBusy !== null}
                      className="rounded-md border border-line bg-panel-2 px-3.5 py-2.5 text-sm font-medium transition hover:border-accent disabled:opacity-50"
                    >
                      {identBusy === id ? "Redirecting…" : "Link"}
                    </button>
                  )}
                </div>
              </Row>
            );
          })}
          {identError && <p className="px-4 sm:px-5 pb-4 text-xs text-danger">{identError}</p>}
        </Card>

        {/* --- yıkıcı işlem: hesap silme (§9.10) -------------------------- */}
        <Card
          title="Danger zone"
          description="Actions that affect your sign-in or remove your account."
        >
          {hasPassword ? (
            <Row
              label="Change password"
              hint="Your current password stops working as soon as the new one is set. Hosts are not affected."
            >
              <button
                onClick={() => {
                  setPwFormError(null);
                  setPwNotice(null);
                  setPwStep("form");
                }}
                className="rounded-md border border-danger/40 px-3.5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/10"
              >
                Change password
              </button>
              {pwNotice && <p className="mt-2 text-xs text-ok">{pwNotice}</p>}
            </Row>
          ) : (
            <Row
              label="Password"
              hint={`You sign in with ${signInNames}, so there is no password to change.`}
            >
              <span className="text-sm text-muted">Managed by {signInNames}</span>
            </Row>
          )}
          <Row
            label="Delete account"
            hint={`Removes ${devices ? devices.length : "all"} host${devices?.length === 1 ? "" : "s"}, and every metric, log and crash snapshot they ever sent. There is no recovery — not from TraceBox, not from Supabase.`}
          >
            <button
              onClick={() => {
                setDeleteError(null);
                setDeleteStep("type");
              }}
              className="flex items-center gap-2 rounded-md border border-danger/40 px-3.5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/10"
            >
              <IconTrash className="size-4" />
              Delete account
            </button>
          </Row>
        </Card>
      </div>

      {pwStep === "form" && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPwStep(null);
          }}
          onKeyDown={(e) => e.key === "Escape" && setPwStep(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Change password"
            onSubmit={handlePasswordSubmit}
            className="w-full max-w-md rounded-card border border-line bg-panel p-6 shadow-xl"
          >
            <h2 className="font-semibold">Change password</h2>
            <div className="mt-4 space-y-4">
              {(
                [
                  { id: "current-password", label: "Current password", value: currentPw, set: setCurrentPw, auto: "current-password" },
                  { id: "new-password", label: "New password", value: newPw, set: setNewPw, auto: "new-password" },
                  { id: "repeat-password", label: "Repeat new password", value: repeatPw, set: setRepeatPw, auto: "new-password" },
                ] as const
              ).map(({ id, label, value, set, auto }, i) => (
                <div key={id}>
                  <label htmlFor={id} className="block text-sm text-muted">
                    {label}
                  </label>
                  <PasswordInput
                    id={id}
                    name={id}
                    required
                    autoFocus={i === 0}
                    autoComplete={auto}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    wrapperClassName="mt-1.5"
                  />
                </div>
              ))}
              <p className="text-xs text-faint">{PASSWORD_RULE_HINT}</p>
            </div>

            {pwFormError && (
              <p className="mt-4 text-sm text-danger" role="alert">
                {pwFormError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPwStep(null)}
                className="rounded-md border border-line px-4 py-2.5 text-sm text-muted transition hover:bg-panel-2 hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong"
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      )}

      {unlinkTarget && (
        <ConfirmDialog
          title={`Unlink ${providerLabel(unlinkTarget.provider)}?`}
          warning="You can link it again at any time."
          confirmLabel="Unlink"
          busy={identBusy !== null}
          onConfirm={handleUnlink}
          onCancel={() => setUnlinkTarget(null)}
        >
          You will no longer be able to sign in with this provider. Your hosts and data are not affected, and your other sign-in methods keep working.
        </ConfirmDialog>
      )}

      {pwStep === "confirm" && (
        <ConfirmDialog
          title="Change password"
          confirmLabel="Change password"
          // §9.10: şifre değiştirme "geri alınamaz" DEMEZ — söylenen gerçek
          // "mevcut şifren geçersiz olacak".
          warning="Your current password will stop working. Do you want to continue?"
          busy={pwBusy}
          error={pwError}
          onConfirm={handleChangePassword}
          onCancel={() => setPwStep("form")}
        >
          <p>
            You will need the new password the next time you sign in. Hosts are
            not affected — they authenticate with their own device keys.
          </p>
        </ConfirmDialog>
      )}

      {deleteStep === "type" && (
        <ConfirmDialog
          title="Delete account"
          confirmLabel="Continue"
          requireText={email}
          requireHint={`Type your account email (${email}) to confirm.`}
          onConfirm={() => setDeleteStep("final")}
          onCancel={() => setDeleteStep(null)}
        >
          <p>
            Your account, every host you registered, and all of their
            metrics, logs and crash snapshots will be deleted immediately.
          </p>
          <p>
            Each host&rsquo;s agent keeps running and shipping — its key
            simply stops matching anything, so it will get 401s. Run{" "}
            <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-xs">
              uninstall.sh
            </code>{" "}
            on machines you can still reach if you want them fully cleaned up.
          </p>
        </ConfirmDialog>
      )}

      {deleteStep === "final" && (
        <ConfirmDialog
          title="Are you absolutely sure?"
          confirmLabel="Yes, delete my account"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={handleDeleteAccount}
          onCancel={() => setDeleteStep(null)}
        >
          <p>This is the last step. Once you confirm, the deletion starts right away.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
