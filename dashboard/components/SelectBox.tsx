/**
 * Kutulu seçici — referans 2'de üç yerde aynı kabuk var: üst çubuktaki host ve
 * zaman seçicileri, System Metrics'in "All Hosts"u, Top Hosts'un "CPU Usage"ı.
 *
 * Yerli `<select>` kullanılıyor, kendi yaptığım bir açılır liste değil: klavye
 * gezinme, dokunmatik ekranın kendi tekerleği ve ekran okuyucu desteği
 * bedavaya geliyor. `appearance-none` ile tarayıcının oku söndürülüp yerine
 * referanstaki chevron konuyor; seçici tamamen şeffaf olarak kutunun üstünü
 * kaplıyor, yani tıklama alanı kutunun tamamı.
 *
 * Kutuda görünen metin `label` ile ayrıca veriliyor: seçili `<option>`un metni
 * her zaman kutuda yazması gereken şey değil (üst çubukta "All Hosts" yerine
 * cihazın adı yazıyor).
 */
"use client";

import { IconChevronDown } from "./icons";

export function SelectBox({
  value,
  onChange,
  label,
  icon,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm font-medium">
        {icon}
        <span className="whitespace-nowrap">{label}</span>
        <IconChevronDown className="size-4 shrink-0 text-muted" />
      </div>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
      >
        {children}
      </select>
    </div>
  );
}
