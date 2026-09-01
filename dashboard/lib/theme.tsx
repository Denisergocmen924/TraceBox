/**
 * Tema durumu (CLAUDE.md §9.11.1 — açık varsayılan, koyu seçenek).
 *
 * Tek gerçek kaynak `<html data-theme>` özniteliği; renkler oradan türüyor
 * (app/globals.css). React state yalnızca düğmenin hangi simgeyi göstereceğini
 * biliyor. İkisi ters sırada olsaydı — önce state, sonra öznitelik — ilk
 * boyamada yanlış tema görünür, React devreye girince ekran bir kez çakardı.
 *
 * Seçim localStorage'da: sunucu tarafında kullanıcının temasını bilmenin bir
 * yolu yok ve bunun için bir tablo/istek eklemek, bir düğmenin bedeli olarak
 * fazla ağır olurdu. Bedeli, tercihin cihaz başına saklanması — kabul edildi.
 */
"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "tracebox-theme";

/**
 * <head>'e gömülen minik script — SAYFA BOYANMADAN ÖNCE çalışır.
 *
 * Olmasaydı: sunucu açık temayı yollar, tarayıcı onu bir kare boyar, sonra
 * React localStorage'ı okuyup koyuya çevirirdi. Koyu tema kullanan biri her
 * sayfa açılışında beyaz bir flaş görürdü. Bu script o flaşı engelliyor.
 *
 * Tercih yoksa AÇIK tema. Sistem tercihine (prefers-color-scheme) bilerek
 * bakılmıyor: varsayılan referans 2 ve o açık; işletim sistemi koyu diye
 * kullanıcıyı hiç seçmediği bir temaya düşürmek sürpriz olurdu.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  KEY,
)});document.documentElement.dataset.theme=(t==="dark"?"dark":"light")}catch(e){}})();`;

type ThemeContext = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeContext | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setState] = useState<Theme>("light");

  // İlk oturumda DOM'u okuyoruz, localStorage'ı değil: yukarıdaki script
  // zaten okudu ve uyguladı. İkinci kez okumak, iki kaynağın birbirinden
  // ayrılabileceği bir yol açardı.
  useEffect(() => {
    setState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function setTheme(next: Theme) {
    document.documentElement.dataset.theme = next;
    setState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Gizli sekmede veya depolama kapalıyken yazma patlar. Tema yine de
      // değişsin; yalnızca bir sonraki açılışta hatırlanmaz.
    }
  }

  return (
    <Ctx.Provider
      value={{
        theme,
        setTheme,
        toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeContext {
  const value = useContext(Ctx);
  if (!value) throw new Error("useTheme was called outside ThemeProvider.");
  return value;
}
