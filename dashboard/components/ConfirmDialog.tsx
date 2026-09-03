/**
 * Yıkıcı işlem onayı (CLAUDE.md §9.10) — KURAL, bileşen değil.
 *
 * Geri alınamayan her işlem buradan geçer: cihaz silme, zorla kaldırma, hesap
 * silme, anahtarın bir kez gösterildiği pencere, şifre sıfırlama. Tek tek
 * `window.confirm` çağırmak da olurdu; olmazdı, çünkü §9.10 tarayıcının
 * vermediği üç şeyi şart koşuyor: vurgusuz tehlike düğmesi, odaklı ve
 * varsayılan `Go back`, ve gerektiğinde cihaz adını yazdırma.
 *
 * Uyarı metni KİLİTLİ ve çağıran tarafından değiştirilemez — sabit bir cümle
 * olmasının anlamı, kullanıcının onu tanıyıp "bu pencere ciddi" diye
 * öğrenmesi. Yalnızca §9.10'un ayrık tuttuğu durum (şifre sıfırlama "geri
 * alınamaz" DEMEZ) için `warning` ile başka bir cümle verilebiliyor.
 *
 * Portal kullanılmadı: pencere `position: fixed` ve üstündeki hiçbir atada
 * transform/filter yok (sticky bir kapsayıcı blok oluşturmaz), dolayısıyla
 * ekrana göre konumlanıyor. Portal, sırf ihtimale karşı bir DOM katmanı
 * eklemek olurdu.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlert } from "@/components/icons";

/**
 * §9.10'da harfi harfine yazılı cümle — İngilizce karşılığı.
 *
 * Spec Türkçe yazıldı, ürün İngilizce (2026-08-30 kararı: arayüzün tamamı
 * İngilizce). Cümlenin İŞLEVİ korunuyor: geri alınamazlığı söylüyor ve
 * kullanıcıdan bunu bildiğini onaylamasını istiyor. Metin yine KİLİTLİ —
 * çağıran taraf değiştiremez, çünkü tanınabilir olması gerekiyor.
 */
export const IRREVERSIBLE_WARNING =
  "You will not be able to undo this later. Do you understand and accept that?";

export function ConfirmDialog({
  title,
  children,
  warning = IRREVERSIBLE_WARNING,
  confirmLabel = "Yes",
  cancelLabel = "Go back",
  requireText,
  requireHint,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** Ne olacağının anlatısı. Uyarı cümlesi bunun altında, sabit. */
  children: React.ReactNode;
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Verilirse kullanıcı bu metni harfi harfine yazmadan onay düğmesi açılmaz
   * (§9.10 — cihaz silmede cihazın adı; GitHub'ın depo silme deseni). 10 günlük
   * metrik + log + çöküş kaydını CASCADE ile yok eden bir işlem için tek
   * tıklama fazla kolay kalıyor.
   */
  requireText?: string;
  requireHint?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const ready = requireText == null || typed === requireText;

  // Odak GÜVENLİ düğmede açılıyor (§9.10: "Geri Al varsayılan ve odaklıdır").
  // Yazma kutusu varsa bile oraya odaklanmıyoruz: pencere açılır açılmaz imleci
  // metin kutusuna koymak, kullanıcıyı silmeye doğru bir adım itmek olurdu.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      /*
       * Enter da iptal eder — §9.10: "kullanıcının refleksle bastığı tuş her
       * zaman güvenli tarafa düşer". Formda Enter'a basma alışkanlığı, adını
       * yazdırdığımız kutuda tam da yıkıcı işlemi tetiklerdi.
       *
       * Tek istisna: odak ZATEN onay düğmesindeyse. Oraya sekmeyle gitmek
       * refleks değil, bilinçli bir hareket; yoksa klavyeyle çalışan biri
       * pencereyi hiçbir zaman onaylayamazdı.
       */
      if (event.key === "Enter" && document.activeElement !== confirmRef.current) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
      // Zeminden çıkmak da güvenli taraf: yanlışlıkla açılan pencere bir
      // tıklamayla kapanmalı, kapatmak için düğme aramak gerekmemeli.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-card border border-line bg-panel p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger">
            <IconAlert className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
          </div>
        </div>

        <p className="mt-4 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm text-danger">
          {warning}
        </p>

        {requireText != null && (
          <label className="mt-4 block">
            <span className="text-xs text-muted">
              {requireHint ?? `Type "${requireText}" to confirm.`}
            </span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-sm outline-none focus:border-danger"
            />
          </label>
        )}

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {/*
            Tehlikeli düğme VURGUSUZ (§9.10): dolu kırmızı değil, kırmızı
            kenarlıklı. Göz önce güvenli seçeneğe gitmeli — dolu zemin, en son
            istediğimiz şeyi ekranın en davetkâr nesnesi yapardı.
          */}
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={!ready || busy}
            className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
