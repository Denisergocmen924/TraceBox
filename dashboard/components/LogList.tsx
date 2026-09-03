/**
 * Log listesi (CLAUDE.md §9.4 + §9.5 + §9.9).
 *
 * Kaydırdıkça artımlı gelir: önce en yeni blok, o bittikçe bir öncesi.
 * Kullanıcı dibe DEĞMEDEN önden çekilir (sentinel, viewport'un ~600px altında)
 * — dibe değince yüklemek, her seferinde görünür bir duraklama demek olurdu.
 *
 * Satırlar BLOK BLOK gruplu tutuluyor, tek düz dizide değil. Sebep §9.5'in
 * son maddesi: "ekrandan 4 blok uzaklaşan bloklar bellekten atılır". Düz bir
 * dizide bir bloğun nerede başlayıp bittiği bilinemez, dolayısıyla atılamaz.
 * Ölçüt MESAFE, süre değil — süre olsaydı log okurken düşünen kullanıcının
 * verisi altından silinir ve aynı veri iki kez inerdi.
 *
 * Zaman penceresi PROP DEĞİL, appState'ten okunuyor (§9.8: "zaman aralığı
 * TEKTİR"). Grafikte sürükleyerek yakınlaşmak aynı pencereyi daralttığı için
 * bu liste kendiliğinden o ana iniyor — kullanıcının zaman damgalarını gözüyle
 * eşleştirmesi gerekmiyor.
 *
 * En üstte CANLI bölüm var (§9.9): pencere şimdiye bakarken açık bir Realtime
 * kanalı, gelen her yeni satırı anında yukarı ekliyor. Sayfalanmış listeyle
 * karışmıyor — sayfalanan sorgunun sağ ucu `anchor`da dondurulmuş durumda,
 * yani canlı satırlar tanım gereği onun dışında kalıyor.
 *
 * İKİ YERDE kullanılıyor: cihaz detayında tek bir makinenin logları, Logs
 * sayfasında hesabın tamamı (`deviceId = null`). Fark yalnızca bir sütun —
 * hesap genelinde her satır hangi makineden geldiğini de yazıyor. Sayfaya
 * ayrı bir liste yazmak, blok atma/geri getirme ve canlı tavan mantığını
 * ikinci kez yazmak olurdu.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import { LiveLock } from "./LiveLock";
import {
  FILTER_LEVELS,
  LEVEL_FILTER_LABEL,
  blocksForWindow,
  fetchLogPage,
  type LevelFilter,
  type LogLevel,
  type LogRow,
} from "@/lib/logs";
import { subscribeLogs } from "@/lib/realtime";
import { logTime } from "@/lib/time";
import { errorMessage } from "@/lib/errors";
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

const FILTERS: LevelFilter[] = ["all", "info", "warning", "error", "critical"];

/**
 * Ekrandan bu kadar blok uzaklaşan bloklar bellekten atılır (§9.5).
 *
 * Dört, cömert bir sayı: kullanıcı dört gün geriye kaydırıp geri dönene kadar
 * hiçbir şey yeniden inmiyor. Buna karşılık 10 günlük bir pencerede bile
 * bellekte en fazla dokuz blok duruyor — sınırsız birikim, uzun bir oturumda
 * sekmeyi yüz binlerce DOM satırıyla baş başa bırakırdı.
 */
const EVICT_DISTANCE = 4;

/**
 * §9.9'un ZORUNLU kıldığı iki tavan.
 *
 * Bir hata döngüsü saniyede yüzlerce log üretebilir. Her satırda ekranı
 * boyamak tarayıcıyı kilitler; sınırsız biriktirmek belleği. İkisi de
 * kullanıcının çöküşü inceleyemeden sekmeyi kaybetmesi demek — yani tam da
 * ürünün var olma sebebinin çalışmadığı an.
 */
const LIVE_FLUSH_MS = 1000;
const LIVE_MAX_ROWS = 500;

/** Bellekte duran (ya da yerini yüksekliğine bırakmış) tek bir gün bloğu. */
type Block = {
  key: string;
  /** `null` = atıldı. Yerinde yalnızca `height` kadar boşluk duruyor. */
  rows: LogRow[] | null;
  /** Bu bloktan kaç satır çekilmişti — geri getirirken aynısı isteniyor. */
  count: number;
  /** Blokta çekilecek başka satır kalmadı. */
  done: boolean;
  /** Atılırken ölçülen yükseklik; kaydırma çubuğu zıplamasın diye. */
  height: number;
};

/** Tek log satırı — canlı bölüm ve sayfalanmış liste aynı biçimi kullanıyor. */
function Line({
  row,
  now,
  hostName,
}: {
  row: LogRow;
  now: number;
  /** Yalnızca hesap genelinde dolu; cihaz detayında sütun hiç çizilmiyor. */
  hostName?: string;
}) {
  return (
    <li className="flex gap-3 px-5 py-2.5 text-xs leading-relaxed transition hover:bg-panel-2/50">
      <span className="w-16 shrink-0 pt-0.5 font-mono tabular-nums text-faint">
        {logTime(row.measured_at, now)}
      </span>
      {hostName !== undefined && (
        /* Makine adı BAĞLANTI: bir hata satırı görüldüğünde bir sonraki soru
           her zaman "o makinede başka ne oluyordu" ve cevabı cihaz detayında.
           Adı düz metin olsaydı kullanıcı listeye geri dönüp makineyi elle
           bulmak zorunda kalırdı. */
        <Link
          href={`/devices/${row.device_id}`}
          title={hostName}
          className="w-28 shrink-0 truncate pt-0.5 font-medium text-accent transition hover:text-accent-strong"
        >
          {hostName}
        </Link>
      )}
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
  );
}

export function LogList({
  deviceId,
  deviceNames,
  scrollerClass = "max-h-[32rem]",
}: {
  /** `null` = hesabın tüm cihazları (Logs sayfası). */
  deviceId: string | null;
  /**
   * Verilirse her satır hangi makineden geldiğini yazar. Hesap genelinde
   * ZORUNLU: kaynağı yazmayan bir akış, iki makinenin loglarını tek bir
   * makinenin logu gibi gösterirdi.
   */
  deviceNames?: Map<string, string>;
  /** Kaydırma kutusunun yüksekliği. Kendi sayfasında ekranın tamamı kadar. */
  scrollerClass?: string;
}) {
  const { timeWindow, zoomDepth, locked, now } = useApp();
  const { from: fromMs, to: toMs } = timeWindow;

  const [level, setLevel] = useState<LevelFilter>("all");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveRows, setLiveRows] = useState<LogRow[]>([]);
  const [connected, setConnected] = useState(false);

  /*
   * Blok anahtarları — 24 saatlik UTC blokları (§9.5).
   *
   * Bağımlılık dizi DEĞİL, dizinin METNİ. Kilit açıkken pencere saniyeler
   * içinde kayıyor ve `blocksForWindow` her çağrıda YENİ bir dizi döndürüyor;
   * kimliğe bağlanan aşağıdaki sıfırlama efekti, gün hiç değişmese bile her
   * kaymada tetiklenir ve okunan liste kullanıcının altından silinirdi.
   * Metin ise ancak gün kümesi gerçekten değiştiğinde (UTC gece yarısı ya da
   * yeni bir aralık) başkalaşıyor.
   */
  const keySignature = blocksForWindow(fromMs, toMs).join(" ");
  const keys = useMemo(() => keySignature.split(" "), [keySignature]);

  /*
   * Blokların ref kopyası. Yükleyici bir `while` döngüsü içinde art arda
   * istek atıyor ve her turda "en son nerede kaldım"ı okuması gerekiyor;
   * state güncellemesi bir sonraki render'a kadar görünmediği için ref
   * gerçeğin kaynağı, state ise yalnızca çizim kopyası.
   */
  const blocksRef = useRef<Block[]>([]);
  const commit = useCallback((next: Block[]) => {
    blocksRef.current = next;
    setBlocks(next);
  }, []);

  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  /** Blok anahtarı → o bloğun DOM kutusu. Yükseklik ölçümü ve konum için. */
  const nodes = useRef(new Map<string, HTMLDivElement>());

  // Eşzamanlılık kilidi state DEĞİL ref: state güncellemesi asenkron, iki
  // sentinel tetiklemesi arka arkaya gelirse ikisi de "boşta" görür ve aynı
  // sayfa iki kez inerdi.
  const busy = useRef(false);
  /** Şu an geri getirilmekte olan bloklar — aynı bloğu iki kez istememek için. */
  const restoring = useRef(new Set<string>());

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
    busy.current = false;
    restoring.current.clear();
    nodes.current.clear();
    blocksRef.current = [];
    setBlocks([]);
    setLiveRows([]);
    setFinished(false);
    setError(null);
    scroller.current?.scrollTo({ top: 0 });
  }, [deviceId, level, keys]);

  /* --- sayfalama --------------------------------------------------------- */

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);

    const mine = epoch.current;
    try {
      // Boş bloklar sessizce atlanır: 10 günün 7'sinde hiç error yoksa
      // kullanıcının 7 kez daha kaydırması gerekmemeli.
      for (;;) {
        const current = blocksRef.current;
        const last = current[current.length - 1];

        // Sıradaki hedef: son blok bitmediyse onun bir sonraki sayfası,
        // bittiyse listedeki bir sonraki blok.
        const index = last && !last.done ? current.length - 1 : current.length;
        if (index >= keys.length) {
          setFinished(true);
          break;
        }
        const key = keys[index];
        const offset = index < current.length ? current[index].count : 0;

        const page = await fetchLogPage({
          deviceId,
          block: key,
          level,
          offset,
          windowFromMs: fromMs,
          windowToMs: toMs,
        });
        if (mine !== epoch.current) return; // sorgu eskidi, yanıtı at

        const next = [...blocksRef.current];
        if (index === next.length) {
          next.push({
            key,
            rows: page.rows,
            count: page.rows.length,
            done: page.blockDone,
            height: 0,
          });
        } else {
          const b = next[index];
          next[index] = {
            ...b,
            rows: [...(b.rows ?? []), ...page.rows],
            count: b.count + page.rows.length,
            done: page.blockDone,
          };
        }
        commit(next);

        if (next.length >= keys.length && page.blockDone) setFinished(true);
        if (page.rows.length > 0) break;
      }
      setError(null);
    } catch (e) {
      if (mine !== epoch.current) return;
      setError(errorMessage(e));
      setFinished(true); // durmadan yeniden denemek hatayı çoğaltmaktan başka işe yaramaz
    } finally {
      if (mine === epoch.current) busy.current = false;
      setLoading(false);
    }
  }, [deviceId, level, keys, fromMs, toMs, commit]);

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
  }, [loadMore, finished, blocks]);

  /* --- blok atma ve geri getirme (§9.5) ---------------------------------- */

  /** Atılmış bir bloğu, atıldığı andaki satır sayısıyla tek istekte geri çek. */
  const restore = useCallback(
    async (block: Block) => {
      if (restoring.current.has(block.key)) return;
      restoring.current.add(block.key);
      const mine = epoch.current;
      try {
        const page = await fetchLogPage({
          deviceId,
          block: block.key,
          level,
          offset: 0,
          windowFromMs: fromMs,
          windowToMs: toMs,
          limit: block.count,
        });
        if (mine !== epoch.current) return;

        const next = blocksRef.current.map((b) =>
          b.key === block.key
            ? // `done` KORUNUYOR: buradaki istek bloğun tamamını değil, daha
              // önce çekilmiş kadarını istiyor. Dönen sayıya bakıp "bitti"
              // demek, sayfalamanın kaldığı yeri unutmak olurdu.
              { ...b, rows: page.rows, count: page.rows.length }
            : b,
        );
        commit(next);
      } catch {
        // Sessiz: blok yerinde (yüksekliğiyle) duruyor, bir sonraki
        // kaydırmada yeniden denenecek. Ekrana hata basmak, sayfalamanın
        // kendi hata satırıyla karışırdı.
      } finally {
        restoring.current.delete(block.key);
      }
    },
    [deviceId, level, fromMs, toMs, commit],
  );

  /**
   * Kaydırma sırasında: ekrandaki bloğu bul, uzaktakileri at, yakındakileri
   * geri getir.
   *
   * rAF ile kısılıyor — kaydırma olayı saniyede onlarca kez geliyor ve her
   * birinde tüm blokların kutusunu ölçmek, tam da akıcı olması gereken anda
   * yerleşimi yeniden hesaplatırdı.
   */
  const ticking = useRef(false);
  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const el = scroller.current;
      if (!el) return;

      const top = el.scrollTop;
      let visible = 0;
      blocksRef.current.forEach((b, i) => {
        const node = nodes.current.get(b.key);
        if (node && node.offsetTop <= top + 1) visible = i;
      });

      let changed = false;
      const next = blocksRef.current.map((b, i) => {
        const near = Math.abs(i - visible) <= EVICT_DISTANCE;
        if (near || b.rows === null) return b;
        changed = true;
        const node = nodes.current.get(b.key);
        return { ...b, rows: null, height: node?.offsetHeight ?? b.height };
      });
      if (changed) commit(next);

      for (const [i, b] of next.entries()) {
        if (b.rows === null && b.count > 0 && Math.abs(i - visible) <= EVICT_DISTANCE) {
          restore(b);
        }
      }
    });
  }, [commit, restore]);

  /* --- canlı akış (§9.9) -------------------------------------------------- */

  /*
   * Canlı akışı yakınlaştırma değil, YALNIZCA kilit belirliyor — grafikteki
   * kuralın aynısı (lib/appState.tsx). Yakınlaşmak tek başına "geçmişe
   * bakıyorum" demek değil; geçmişe yapılan seçim zaten kilidi kendiliğinden
   * kapatıyor. İki panel aynı bayrağa bakmasaydı §9.8'in tek aralık kuralı
   * kırılırdı: grafik akarken donmuş bir log listesi, sıçramanın logunu hiç
   * göstermezdi.
   */
  const liveOn = !locked;

  /** Ekrana basılmayı bekleyen satırlar. Saniyede bir boşaltılıyor. */
  const buffer = useRef<LogRow[]>([]);

  useEffect(() => {
    if (!liveOn) {
      setConnected(false);
      return;
    }

    const allowed = FILTER_LEVELS[level];
    const stop = subscribeLogs({
      deviceId,
      onStatus: setConnected,
      onInsert: (row) => {
        // Süzgeç canlı satırlara da uygulanıyor: "error" seçiliyken akan bir
        // info satırı, süzgecin yalan söylemesi olurdu.
        if (allowed.includes(row.level)) buffer.current.push(row);
      },
    });

    const timer = setInterval(() => {
      if (buffer.current.length === 0) return;
      const batch = buffer.current;
      buffer.current = [];

      setLiveRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const row of batch) {
          if (seen.has(row.id)) continue; // at-least-once teslim → tekrar mümkün
          seen.add(row.id);
          merged.push(row);
        }
        merged.sort((a, b) => b.measured_at.localeCompare(a.measured_at));
        return merged.slice(0, LIVE_MAX_ROWS); // tavan: eskisi düşer
      });
    }, LIVE_FLUSH_MS);

    return () => {
      stop();
      clearInterval(timer);
      buffer.current = [];
    };
  }, [deviceId, level, liveOn]);

  /* --- çizim -------------------------------------------------------------- */

  const liveIds = useMemo(() => new Set(liveRows.map((r) => r.id)), [liveRows]);

  /*
   * Adı bilinmeyen cihaz için "—" yazılıyor, sütun atlanmıyor: cihaz listesi
   * 10 saniyede bir yenileniyor ve yeni eklenmiş bir makinenin logu haritadan
   * birkaç saniye önce gelebilir. Sütunun o satırda kaybolması, altındaki
   * bütün hizayı kaydırırdı.
   */
  const hostNameOf = (row: LogRow) =>
    deviceNames ? (deviceNames.get(row.device_id) ?? "—") : undefined;
  const total =
    liveRows.length +
    blocks.reduce((sum, b) => sum + (b.rows?.length ?? b.count), 0);
  const empty = total === 0;

  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <IconList className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-medium">Logs</h2>
          {/*
            Yakınlaşılmışken bunu YAZMAK zorunlu: liste sessizce kısalmış
            olurdu ve kullanıcı, o aralıkta gerçekten log olmadığını sanırdı.
            Grafiğin "her nokta = X" satırıyla aynı dürüstlük kuralı
            (§9.6 madde 5).
          */}
          <p className="mt-0.5 text-xs text-faint">
            {total} rows{finished ? "" : " and counting"} ·{" "}
            {zoomDepth > 0 ? "range selected on the chart" : "selected range"}
          </p>
        </div>

        {/* Kilit + rozet; grafikteki ikilinin aynısı (components/LiveLock.tsx).
            Aynı bayrağı çeviriyorlar — Logs sayfasında grafik yok, kilit orada
            da bir yerde bulunmak zorunda. */}
        <LiveLock connected={connected} />

        {/*
          Süzgeç TAM EŞLEŞME: her düğme yalnızca kendi seviyesini gösterir
          (lib/logs.ts). Beş düğme dar bir alanda duruyor, o yüzden yatayda
          kaydırılabilir — kırpılıp son seçeneği gizlemek, "critical" satırını
          hiç bulunamaz yapardı.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-bg-soft p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setLevel(f)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                level === f ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              {LEVEL_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className={`relative overflow-y-auto ${scrollerClass}`}
      >
        {error && (
          <p className="px-5 py-4 text-sm text-danger">
            Could not read logs: {error}
          </p>
        )}

        {empty && finished && !error && (
          <p className="px-5 py-16 text-center text-sm text-muted">
            No logs in this range.
          </p>
        )}

        {/* --- canlı bölüm ---------------------------------------------- */}
        {liveRows.length > 0 && (
          <>
            <p className="sticky top-0 z-10 border-b border-line bg-ok-soft/60 px-5 py-1.5 text-[11px] font-medium text-ok backdrop-blur">
              {liveRows.length} new since you opened this view
              {liveRows.length >= LIVE_MAX_ROWS && ` · oldest dropped at ${LIVE_MAX_ROWS}`}
            </p>
            <ul className="divide-y divide-line/50">
              {liveRows.map((row) => (
                <Line
                  key={row.id}
                  row={row}
                  now={now}
                  hostName={hostNameOf(row)}
                />
              ))}
            </ul>
          </>
        )}

        {/* --- sayfalanmış bloklar -------------------------------------- */}
        {blocks.map((block) => (
          <div
            key={block.key}
            ref={(el) => {
              if (el) nodes.current.set(block.key, el);
              else nodes.current.delete(block.key);
            }}
            /* Atılmış blok yerini yüksekliğine bırakıyor: satırlar gidince
               kaydırma çubuğu kısalsaydı, kullanıcının baktığı yer altından
               kayardı (§9.5 "geri dönülünce yeniden çekilir"). */
            style={block.rows === null ? { height: block.height } : undefined}
          >
            {block.rows && (
              <ul className="divide-y divide-line/50">
                {block.rows
                  .filter((row) => !liveIds.has(row.id))
                  .map((row) => (
                    <Line
                      key={row.id}
                      row={row}
                      now={now}
                      hostName={hostNameOf(row)}
                    />
                  ))}
              </ul>
            )}
          </div>
        ))}

        {/* Sentinel: görünür alana yaklaşınca bir sonraki sayfayı tetikler. */}
        <div ref={sentinel} />

        {loading && <p className="px-5 py-4 text-xs text-faint">Loading…</p>}
      </div>
    </section>
  );
}
