/**
 * Şifre alanı + göster/gizle düğmesi.
 *
 * Şifre girilen HER yer (giriş, kayıt, kurtarma, Settings'ten değiştirme) bunu
 * kullanır. Ayrı ayrı yazılsaydı biri düğmesiz kalır, kullanıcı bir ekranda
 * gözle kontrol edebildiği şifreyi ötekinde edemezdi — oysa 12 karakterlik
 * bir şifreyi körlemesine yazmak tam da bu kuralın getirdiği sürtünme.
 *
 * Düğme `type="button"`: formun içinde olduğu için varsayılan "submit" olsaydı
 * her göz tıklaması formu gönderirdi (ConfirmDialog'ta Enter/tıklama
 * güvenlik semantiği taşıdığından bu yan etki gerçek bir risk).
 */
"use client";

import { useState } from "react";
import { IconEye, IconEyeOff } from "@/components/icons";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Dış kap için sınıflar (üst boşluk, genişlik). Girdinin kendi stili sabit. */
  wrapperClassName?: string;
};

export function PasswordInput({ wrapperClassName = "", ...input }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...input}
        type={visible ? "text" : "password"}
        // Sağdaki padding, uzun şifrenin düğmenin altına taşmasını önler.
        className="w-full rounded-lg border border-line bg-panel-2 py-2.5 pr-11 pl-3 text-sm outline-none transition focus:border-accent"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition hover:text-fg"
      >
        {visible ? <IconEyeOff className="size-[18px]" /> : <IconEye className="size-[18px]" />}
      </button>
    </div>
  );
}
