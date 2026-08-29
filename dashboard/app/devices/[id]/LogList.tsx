/**
 * Log listesi (CLAUDE.md §9.4 + §9.5).
 *
 * Kaydırdıkça artımlı gelir: önce en yeni blok, o bittikçe bir öncesi.
 * Kullanıcı dibe DEĞMEDEN önden çekilir (sentinel, viewport'un ~600px altında)
 * — dibe değince yüklemek, her seferinde görünür bir duraklama demek olurdu.
 *
 * Blok mantığının tamamı lib/logs.ts'te; buradaki iş yalnızca "sırada hangi
 * sayfa var" defterini tutmak.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LEVEL_FILTER_LABEL,
  blocksForRange,
  fetchLogPage,
  type LevelFilter,
  type LogLevel,
  type LogRow,
} from "@/lib/logs";
import { logTime } from "@/lib/time";

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-muted",
  warning: "text-warn",
  error: "text-danger",
  critical: "text-danger font-semibold",
};

const FILTERS: LevelFilter[] = ["all", "warning", "error"];

export function LogList({
  deviceId,
  rangeSeconds,
  anchor,
  now,
}: {
  deviceId: string;
  /** Seçili aralığın uzunluğu (§9.5). */
  rangeSeconds: number;
  /**
   * Aralığın hesaplandığı an. Saniyede bir tikleyen "now" DEĞİL — o olsaydı
   * aralığın alt sınırı her saniye kayar, listenin tamamı sürekli yeniden
   * çekilirdi. Yalnızca kullanıcı aralığı değiştirdiğinde tazelenir.
   */
  anchor: number;
  now: number;
}) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocks = useMemo(
    () => blocksForRange(anchor, rangeSeconds),
    [anchor, rangeSeconds],
  );
  const rangeStartMs = anchor - rangeSeconds * 1000;

  // Defter: kaçıncı bloktayız, o blokta kaç satır geçtik. Render'ı
  // ilgilendirmediği için state değil ref — her sayfada yeniden çizim olmaz.
  const cursor = useRef({ block: 0, offset: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Eşzamanlılık kilidi state DEĞİL ref: state güncellemesi asenkron, iki
  // sentinel tetiklemesi arka arkaya gelirse ikisi de "boşta" görür ve aynı
  // sayfa iki kez inerdi.
  const busy = useRef(false);

  /**
   * Süzgeç, uçuştaki bir istekten daha hızlı değiştirilebilir. Epoch olmadan
   * "hepsi" için başlamış bir sayfa, kullanıcı "error"a geçtikten sonra dönüp
   * info satırlarını listeye ekleyebilirdi — ekran süzgecin yalan söylediğini
   * gösterirdi. Yanıt, başladığı epoch hâlâ geçerliyse uygulanır.
   */
  const epoch = useRef(0);

  // Cihaz / aralık / süzgeç değişti → defter başa sarılır.
  useEffect(() => {
    epoch.current += 1;
    cursor.current = { block: 0, offset: 0 };
    busy.current = false;
    setRows([]);
    setFinished(false);
    setError(null);
    scroller.current?.scrollTo({ top: 0 });
  }, [deviceId, level, blocks]);

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);

    const mine = epoch.current;
    try {
      // Boş bloklar sessizce atlanır: 10 günün 7'sinde hiç error yoksa
      // kullanıcının 7 kez daha kaydırması gerekmemeli.
      while (cursor.current.block < blocks.length) {
        const { block, offset } = cursor.current;
        const page = await fetchLogPage({
          deviceId,
          block: blocks[block],
          level,
          offset,
          rangeStartMs,
        });
        if (mine !== epoch.current) return; // sorgu eskidi, yanıtı at

        cursor.current = page.blockDone
          ? { block: block + 1, offset: 0 }
          : { block, offset: offset + page.rows.length };

        if (page.rows.length > 0) {
          setRows((prev) => [...prev, ...page.rows]);
          break;
        }
      }
      if (cursor.current.block >= blocks.length) setFinished(true);
      setError(null);
    } catch (e) {
      if (mine !== epoch.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setFinished(true); // durmadan yeniden denemek hatayı çoğaltmaktan başka işe yaramaz
    } finally {
      if (mine === epoch.current) busy.current = false;
      setLoading(false);
    }
  }, [deviceId, level, blocks, rangeStartMs]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || finished) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { root: scroller.current, rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, finished, rows.length]);

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <h2 className="mr-auto font-medium">Loglar</h2>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setLevel(f)}
            className={`rounded-lg px-2.5 py-1 text-sm transition ${
              level === f
                ? "bg-accent text-white"
                : "text-muted hover:text-fg"
            }`}
          >
            {LEVEL_FILTER_LABEL[f]}
          </button>
        ))}
      </header>

      <div ref={scroller} className="max-h-[28rem] overflow-y-auto">
        {error && (
          <p className="px-5 py-4 text-sm text-danger">
            Loglar okunamadı: {error}
          </p>
        )}

        {rows.length === 0 && finished && !error && (
          <p className="px-5 py-8 text-center text-sm text-muted">
            Bu aralıkta log yok.
          </p>
        )}

        <ul className="divide-y divide-line/60">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex gap-3 px-5 py-2 font-mono text-xs leading-relaxed"
            >
              <span className="shrink-0 tabular-nums text-muted">
                {logTime(row.measured_at, now)}
              </span>
              <span className={`w-16 shrink-0 ${LEVEL_STYLE[row.level]}`}>
                {row.level}
              </span>
              <span className="w-24 shrink-0 truncate text-muted" title={row.source ?? ""}>
                {row.source ?? "—"}
              </span>
              <span className="min-w-0 break-words whitespace-pre-wrap">
                {row.message}
              </span>
            </li>
          ))}
        </ul>

        {/* Sentinel: görünür alana yaklaşınca bir sonraki sayfayı tetikler. */}
        <div ref={sentinel} />

        {loading && (
          <p className="px-5 py-4 text-sm text-muted">Yükleniyor…</p>
        )}
      </div>
    </section>
  );
}
