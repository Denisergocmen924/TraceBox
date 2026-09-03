/**
 * Tema düğmesi — üst çubuğun sağ ucunda (referans 1'deki güneş simgesi).
 *
 * Gösterilen simge GİDİLECEK yeri anlatıyor, bulunulan yeri değil: açık
 * temadayken ay, koyu temadayken güneş. Bir düğmenin üstündeki resim, o
 * düğmeye basınca ne olacağının cevabıdır.
 */
"use client";

import { useTheme } from "@/lib/theme";
import { IconMoon, IconSun } from "./icons";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      onClick={toggle}
      aria-label={next}
      title={next}
      className="rounded-lg border border-line bg-panel p-2.5 text-muted transition hover:text-fg"
    >
      {theme === "dark" ? (
        <IconSun className="size-[18px]" />
      ) : (
        <IconMoon className="size-[18px]" />
      )}
    </button>
  );
}
