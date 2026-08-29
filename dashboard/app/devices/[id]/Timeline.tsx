/**
 * Zaman çizelgesi paneli (CLAUDE.md §9.6–§9.8).
 *
 * Grafiğin kendisi HENÜZ YOK: §9.7'deki seyreltme (aralığı ~1000 kovaya bölüp
 * her kovadan min/max/ortalama döndüren SQL fonksiyonu) bir migration
 * gerektiriyor ve migration'ı kullanıcı uyguluyor. Grafiği o fonksiyon olmadan
 * çizmek, 173.000 ham satırı tarayıcıya indirmek demekti.
 *
 * Aralık düğmeleri buna rağmen BUGÜN burada duruyor, çünkü aralık tek ve
 * ortaktır (§9.8): grafikteki seçim log listesini de daraltır. Düğmeleri şimdi
 * log paneline koyup sonra taşımak, aralığın kime ait olduğu konusunda yanlış
 * bir alışkanlık kurardı.
 */
"use client";

import { RANGES, type RangeKey } from "@/lib/logs";

export function Timeline({
  range,
  onRangeChange,
}: {
  range: RangeKey;
  onRangeChange: (key: RangeKey) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
        <h2 className="mr-auto font-medium">Zaman çizelgesi</h2>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => onRangeChange(r.key)}
            className={`rounded-lg px-2.5 py-1 text-sm transition ${
              range === r.key ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            {r.label}
          </button>
        ))}
      </header>

      <div className="grid h-56 place-items-center px-5 text-center">
        <p className="text-sm text-muted">
          Grafik bir sonraki dilimde gelecek (§9.7).
          <br />
          Seyreltme fonksiyonu için bir migration gerekiyor.
        </p>
      </div>
    </section>
  );
}
