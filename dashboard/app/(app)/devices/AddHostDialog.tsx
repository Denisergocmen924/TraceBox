/**
 * "Add Host" penceresi — cihaz kaydı + anahtarın BİR KEZ gösterilmesi.
 *
 * İki aşama, tek pencere:
 *   1. isim  → POST /devices (collector, user JWT)
 *   2. anahtar → kopyala + kurulum satırı + "I saved this key"
 *
 * §9.10'un burada geçerli olan maddesi: *"Anahtar penceresi, 'Anahtarı
 * kaydettim' onaylanmadan kapanmaz — kapandığında düz anahtar kalıcı olarak
 * kaybolur"*. Bu yüzden ikinci aşamada Esc de, zemine tıklamak da pencereyi
 * KAPATMIYOR. Birinci aşamada ikisi de çalışıyor: orada kaybedilecek bir şey
 * yok, kapatmayı zorlaştırmak sadece can sıkardı.
 *
 * `ConfirmDialog` kullanılmadı. O bileşen tek bir soruyu soruyor ve metni
 * kilitli; buradaki pencere iki aşamalı, bir form taşıyor ve gösterdiği şey
 * bir uyarı değil bir SIR. Ortak bir bileşene zorlamak ikisini de bozardı.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { createDevice } from "@/lib/collector";
import { errorMessage } from "@/lib/errors";
import { IconCheck, IconClose, IconCopy, IconKey } from "@/components/icons";

/** Collector'daki `MAX_DEVICE_NAME_LENGTH` ile aynı sayı. */
const MAX_NAME_LENGTH = 64;

/** Kopyalandı geri bildiriminin ekranda kalma süresi. */
const COPIED_FEEDBACK_MS = 2000;

/**
 * §8 — kullanıcı anahtarı alır, repoya yönlendirilir, install.sh'i çalıştırır.
 *
 * Betik indiriliyor ama ÇALIŞTIRILMIYOR: `curl | sudo bash` tek satırda
 * kolaydır, ama kullanıcıya root yetkisiyle koşacak kodu okuma fırsatı
 * bırakmaz. §8 kurulumu "indir, gözden geçir, çalıştır" diye tarif ediyor;
 * satır da öyle.
 */
const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/Denisergocmen924/TraceBox/master/agent/install.sh -o install.sh";

/**
 * Panoya kopyalama.
 *
 * `navigator.clipboard` yalnızca güvenli bağlamda (https ya da localhost) var;
 * kullanıcı collector'ı düz http üzerinden açtığında tanımsız olur. Başarısız
 * olduğunda sessizce geçmek yerine `false` dönüyor — çağıran taraf "kopyalandı"
 * yazmak yerine kullanıcıyı elle seçmeye bırakabiliyor.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyToClipboard(value);
            setCopied(ok);
            setFailed(!ok);
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent-soft"
        >
          {copied ? (
            <IconCheck className="size-3.5" />
          ) : (
            <IconCopy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/*
        `select-all` bilerek: kopyalama düğmesi çalışmadığında (güvenli olmayan
        bağlam) kullanıcı tek tıklamayla tümünü seçebilsin. Anahtar `break-all`
        ile sarılıyor — kırpılsaydı elle seçen kullanıcı yarısını alırdı.
      */}
      <p className="mt-1.5 rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-[13px] break-all select-all">
        {value}
      </p>

      {failed && (
        <p className="mt-1 text-xs text-warn">
          Could not access the clipboard — select the text and copy it manually.
        </p>
      )}
    </div>
  );
}

export function AddHostDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Liste yeni cihazı hemen göstersin diye kabuğun `reload`'u tetiklenir. */
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(
    null,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Anahtar ekrandayken pencere kilitli (§9.10).
  const locked = created !== null;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, busy, onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      const device = await createDevice(trimmed);
      // Cihaz ADI yanıttan alınıyor, formdan değil: collector baştaki ve
      // sondaki boşlukları kırpıyor, yani kayıtlı ad farklı olabilir.
      setCreated({ name: device.device_name, key: device.device_key });
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (!locked && !busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={locked ? "Host key" : "Add host"}
        className="w-full max-w-lg rounded-card border border-line bg-panel p-6 shadow-xl"
      >
        {/* --- başlık ---------------------------------------------------- */}
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <IconKey className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">
              {locked ? "Save this key now" : "Add host"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {locked
                ? "This key is shown once and cannot be recovered."
                : "Give the machine a name. The agent key is generated on the collector."}
            </p>
          </div>

          {/* Kilitliyken kapatma çarpısı YOK — tek çıkış onay kutusu. */}
          {!locked && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-muted transition hover:bg-panel-2 hover:text-fg disabled:opacity-40"
            >
              <IconClose className="size-4" />
            </button>
          )}
        </div>

        {/* --- 1. aşama: isim -------------------------------------------- */}
        {!locked && (
          <form onSubmit={submit} className="mt-5">
            <label className="block">
              <span className="text-xs font-medium text-muted">Host name</span>
              <input
                ref={nameRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="prod-web-01"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <p className="mt-1.5 text-xs text-faint">
              Must be unique within your account.
            </p>

            {error && (
              <p className="mt-4 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:bg-panel-2 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || name.trim().length === 0}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Creating…" : "Create host"}
              </button>
            </div>
          </form>
        )}

        {/* --- 2. aşama: anahtar ----------------------------------------- */}
        {created && (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2.5 text-sm text-warn">
              We only store a hash of this key. Once you close this window it is
              gone for good — you would have to delete the host and start over.
            </p>

            <CopyRow label={`Agent key · ${created.name}`} value={created.key} />

            <div>
              <p className="text-xs font-medium text-muted">Next step</p>
              <p className="mt-1.5 text-sm text-muted">
                Download the installer on the machine, read it, then run it with
                sudo. It asks for the key — it is never passed on the command
                line, so it stays out of your shell history.
              </p>
              <p className="mt-2 rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-xs break-all select-all">
                {INSTALL_COMMAND}
              </p>
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span>I have saved this key somewhere safe.</span>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={!acknowledged}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
