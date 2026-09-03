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

import { useEffect, useState } from "react";
import { useApp } from "@/lib/appState";
import { useTheme } from "@/lib/theme";
import { fetchAccount, type Account } from "@/lib/account";
import { supabase } from "@/lib/supabase";
import { localDateTime } from "@/lib/time";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/PageHeader";
import { IconLogout, IconMoon, IconSun } from "@/components/icons";

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
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 border-b border-line px-5 py-4 last:border-b-0">
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
      <div className="border-b border-line px-5 py-4">
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

  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const collectorUrl = process.env.NEXT_PUBLIC_COLLECTOR_URL ?? null;

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
          <div className="bg-bg-soft px-5 py-4">
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
          <div className="px-5 py-4">
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
            <div className="flex overflow-hidden rounded-lg border border-line">
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
                  className={`flex items-center gap-2 px-3.5 py-2 text-sm transition ${
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

        {/* --- bağlantılar ---------------------------------------------- */}
        <Card
          title="Connections"
          description="Where this dashboard talks to, and where it deliberately does not."
        >
          <Row
            label="Collector"
            hint="Used for exactly one request: creating a host and minting its key. Everything you read comes straight from the database instead."
          >
            {collectorUrl ? (
              <Mono>{collectorUrl}</Mono>
            ) : (
              <span className="text-danger">not configured</span>
            )}
          </Row>
          <Row
            label="Database"
            hint="Read directly from the browser over your session, filtered by row-level security. Live log updates ride the same connection."
          >
            <Mono>{process.env.NEXT_PUBLIC_SUPABASE_URL ?? "—"}</Mono>
          </Row>
        </Card>

        {/* --- oturum ---------------------------------------------------- */}
        <Card
          title="Session"
          description="Signing out clears this browser only; your agents keep shipping."
        >
          <Row
            label="Sign out"
            hint="Hosts authenticate with their own device keys, so nothing stops collecting while you are away."
          >
            <button
              onClick={() => supabase().auth.signOut()}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3.5 py-2 text-sm text-muted transition hover:border-danger/40 hover:text-danger"
            >
              <IconLogout className="size-4" />
              Sign out
            </button>
          </Row>
        </Card>
      </div>

    </div>
  );
}
