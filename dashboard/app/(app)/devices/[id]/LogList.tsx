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
import { IconList } from "@/components/icons";

/**
 * Seviye rozetleri (tasarım planı §13: "log severity seviyelerini renklerle
 * ayır"). Renk anlamla eşleşiyor — kehribar uyarı, kırmızı hata — ve aynı
 * anlamlar dashboard'ın her yerinde geçerli (plan §15).
 *
 * critical, error'dan DOLU zeminle ayrılıyor. İkisi de kırmızı olmalı, çünkü
 * ikisi de agent'ta acil flush tetikliyor (§7); ama aralarındaki fark bir
 * kelimeyi okumaya bırakılamayacak kadar önemli. Dolu zemin, göz satırları
 * tararken durduran tek işaret.
 */
const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "border-line bg-panel-2 text-muted",
  warning: "border-warn/25 bg-warn/10 text-warn",
  error: "border-danger/25 bg-danger/10 text-danger",
  critical: "border-danger bg-danger text-white",
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
    <section className="overflow-hidden rounded-card border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <IconList className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-medium">Loglar</h2>
          <p className="mt-0.5 text-xs text-faint">
            {rows.length} satır{finished ? "" : " ve devamı"} · seçili aralık
          </p>
        </div>

        {/*
          Süzgeç bir EŞİKTİR, tam eşleşme değil: "warning+" seçildiğinde error
          ve critical de listede kalır (lib/logs.ts). Etiketlerdeki artı işareti
          bunu söylüyor — "warning" yazsaydı kullanıcı, süzgecin bir error'ı
          gizlediğini sanabilirdi.
        */}
        <div className="ml-auto flex shrink-0 items-center rounded-lg border border-line bg-bg-soft p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setLevel(f)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                level === f
                  ? "bg-accent text-white"
                  : "text-muted hover:text-fg"
              }`}
            >
              {LEVEL_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </header>

      <div ref={scroller} className="max-h-[32rem] overflow-y-auto">
        {error && (
          <p className="px-5 py-4 text-sm text-danger">
            Loglar okunamadı: {error}
          </p>
        )}

        {rows.length === 0 && finished && !error && (
          <p className="px-5 py-16 text-center text-sm text-muted">
            Bu aralıkta log yok.
          </p>
        )}

        <ul className="divide-y divide-line/50">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex gap-3 px-5 py-2.5 text-xs leading-relaxed transition hover:bg-panel-2/50"
            >
              <span className="w-16 shrink-0 pt-0.5 font-mono tabular-nums text-faint">
                {logTime(row.measured_at, now)}
              </span>
              <span
                className={`h-fit w-20 shrink-0 rounded-md border px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ${LEVEL_STYLE[row.level]}`}
              >
                {row.level}
              </span>
              <span
                className="w-24 shrink-0 truncate pt-0.5 font-mono text-muted"
                title={row.source ?? ""}
              >
                {row.source ?? "—"}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words pt-0.5 font-mono">
                {row.message}
              </span>
            </li>
          ))}
        </ul>

        {/* Sentinel: görünür alana yaklaşınca bir sonraki sayfayı tetikler. */}
        <div ref={sentinel} />

        {loading && (
          <p className="px-5 py-4 text-xs text-faint">Yükleniyor…</p>
        )}
      </div>
    </section>
  );
}
