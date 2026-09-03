/**
 * Zaman çizelgesi paneli (CLAUDE.md §9.5–§9.8).
 *
 * İKİ grafik çiziyor, ikisi de aynı zaman ekseninde:
 *   1. Donanım — CPU / RAM / Disk, hepsi ORTAK yüzde ekseninde üst üste.
 *      Önceki hâl üçünü alt alta ayrı grafiklere koyuyordu; üst üste bindirmek
 *      "CPU fırladığında RAM ne yapıyordu?" sorusunu daha iyi cevaplıyor —
 *      üç değer aynı dikey hizada, göz tek bakışta karşılaştırıyor.
 *   2. Ağ — gelen / giden. AYRI, çünkü ağın yüzde tavanı yok: aynı eksene
 *      konsaydı ya yüzdelerin yanında dümdüz sıfır çizgisi olurdu ya da onları
 *      ezerdi. Gerekçenin uzunu lib/metrics.ts → networkTracks.
 *
 * İki grafik AYNI bileşeni (MetricChart) kullanıyor, aynı `hoverTime`'ı ve aynı
 * sürükleme durumunu paylaşıyor: birinin üstünde gezinen imleç ötekinde de
 * aynı anı işaretliyor, birinde yapılan seçim ikisini birden yakınlaştırıyor.
 * Ayrı durumlar olsaydı kullanıcı iki grafiği gözüyle hizalamak zorunda kalırdı.
 *
 * Tüm ölçüler TEK istekle geliyor: metrics_buckets zaten hepsini birlikte
 * döndürüyor. Ayrı ayrı çekmek aynı satırları iki kez taratır ve çizgiler
 * birbirinden biraz farklı anlara ait olabilirdi.
 *
 * Aralık düğmeleri burada DEĞİL, toolbar'da (§9.8: "zaman aralığı TEKTİR" —
 * aynı seçim log listesini de daraltıyor, o yüzden ikisinin ortağında durmalı).
 * Aynı sebeple yakınlaştırma da appState'te yaşıyor: buradaki sürükleme
 * bittiğinde pencere değişiyor ve log listesi kendiliğinden daralıyor.
 *
 * SÜRÜKLEME DURUMU burada, MetricChart'ta değil: seçim bir ölçüye değil zaman
 * eksenine ait ve bittiğinde tüm sayfanın penceresini değiştiriyor. MetricChart
 * yalnızca çiziyor, kararı burası veriyor.
 *
 * Çöküş işaretleri (§9.4) grafiklerin ÜSTÜNDE ayrı bir şeritte duruyor
 * (CrashMarkers); aynı x eksenini paylaşıyorlar, yani bir işaret ile altındaki
 * sıçrama aynı dikey hizada.
 *
 * CANLI AKIŞ (§9.9) artık burada da var, ama grafiğin ihtiyacına göre: kenar
 * her saniye değil, bir KOVA genişliğinde bir adımla ilerliyor (appState →
 * canlı kenar) ve sürükleme başladığı anda tamamen DONUYOR. Eksenin altından
 * kaymadığı için seçim yapmak hâlâ mümkün — bu dilimden önce canlı akışın
 * grafiğe girmemesinin sebebi tam olarak buydu.
 *
 * Akış YAKINLAŞTIRILMIŞ hâlde de sürüyor; durduran tek şey üst çubuktaki
 * kilit. Yakınlaşmayı ölçüt yapan eski kural iki farklı niyeti aynı kefeye
 * koyuyordu: "şu ana daha yakından bak" ile "geçmişte şu ana bak". İkincisini
 * appState'in kendisi tanıyor (sağ uca değmeyen seçim kilidi kapatıyor), yani
 * kullanıcı geçmişi incelerken de ekranı kaybetmiyor, canlıya bakarken de
 * yakınlaşabiliyor.
 *
 * Yeni veri geldiğinde kovalar SUNUCUDAN yeniden çekiliyor, tarayıcıda
 * güncellenmiyor: seyreltme metrics_buckets'ta yaşıyor (§9.7) ve ikinci bir
 * kopyasını buraya yazmak, iki hesabın zamanla ayrışması demekti.
 *
 * Bileşen `components/` altında, bir sayfanın yanında değil: hem cihaz detayı
 * hem Metrics sayfası aynı çizelgeyi gösteriyor.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import { LiveLock } from "./LiveLock";
import {
  BUCKET_COUNT,
  bucketWidthMs,
  fetchBuckets,
  formatBitrate,
  formatDuration,
  formatPercent,
  hardwareTracks,
  nearestIndex,
  networkTracks,
  plotEndMs,
  tracksCeiling,
  type MetricBucket,
} from "@/lib/metrics";
import { fetchCrashSnapshots, type CrashSnapshot } from "@/lib/crashes";
import { axisTime } from "@/lib/time";
import { errorMessage } from "@/lib/errors";
import {
  IconActivity,
  IconArrowLeft,
  IconExpand,
  IconZoom,
} from "@/components/icons";
import { MetricChart } from "@/components/MetricChart";
import { CrashMarkers } from "@/components/CrashMarkers";

/**
 * Bir sürüklemenin "seçim" sayılması için görünür genişliğin en az bu kadarını
 * kaplaması gerekiyor — yani ~1000 piksellik bir grafikte ~10 piksel.
 *
 * Ölçüt PİKSEL değil ORAN, çünkü grafik esniyor: sabit bir piksel eşiği dar
 * ekranda kolayca aşılır, geniş ekranda zor. Oran her boyutta aynı jesti aynı
 * şekilde yorumluyor.
 *
 * Eşik olmasaydı grafiğe atılan her tıklama bir yakınlaştırma olurdu —
 * kullanıcı yalnızca imleci bir kovanın üstüne getirmek isterken ekran
 * altından kayardı.
 */
const MIN_DRAG_FRACTION = 0.01;

type Drag = { from: number; to: number };

export function Timeline({
  deviceId,
  ramTotalMb,
  heading,
  href,
  showCrashes = true,
}: {
  deviceId: string;
  /** RAM grafiğinin tavanı. Cihazın tamamı değil sadece bu alan gerekiyor:
      künye 10 saniyede bir yenilendiği için tüm nesneye bağlanmak, hiçbir şey
      değişmese bile grafiğin geometrisini yeniden hesaplatırdı. */
  ramTotalMb: number | null;
  /** Başlık. Metrics sayfasında makinenin adı, cihaz detayında "Timeline". */
  heading?: string;
  /** Verilirse başlık cihaz detayına bağlanır (Metrics sayfasında). */
  href?: string;
  /** Metrics sayfasında çöküş şeridi yok: orada ekranda birden çok makine var
      ve her birine bir şerit eklemek sayfayı üç katına çıkarırdı. Çöküş
      kayıtları cihazın kendi sayfasında, tam ayrıntısıyla duruyor. */
  showCrashes?: boolean;
}) {
  const {
    timeWindow,
    zoomDepth,
    locked,
    zoomTo,
    zoomBack,
    zoomReset,
    reloadNonce,
    liveConnected,
    holdLive,
  } = useApp();

  const [buckets, setBuckets] = useState<MetricBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [crashes, setCrashes] = useState<CrashSnapshot[]>([]);
  const [crashTruncated, setCrashTruncated] = useState(false);
  const [crashLoading, setCrashLoading] = useState(true);

  const { from: fromMs, to: toMs } = timeWindow;
  const spanMs = toMs - fromMs;
  const widthMs = bucketWidthMs(fromMs, toMs, BUCKET_COUNT);

  /**
   * Uçuştaki bir istek, kullanıcı pencereyi değiştirdikten sonra dönebilir.
   * Epoch olmadan 10 günlük yanıt, ekran çoktan üç dakikalık bir seçime
   * geçmişken grafiğe yazılırdı — kullanıcı seçtiğinden başka bir aralığa
   * bakıyor olurdu.
   */
  const epoch = useRef(0);

  /**
   * Bir önceki çekimin kimliği — "pencere değişti mi, yoksa canlı kenar mı
   * kaydı?" sorusunu ayırt etmek için.
   *
   * Ayrım şart: kenar dakikada birkaç kez ilerliyor ve her ilerlemede
   * yükleniyor iskeletini göstermek, kullanıcı hiçbir şey yapmadığı hâlde
   * grafiği durmadan kırpıştırırdı. Aynı sebeple imlecin altındaki an da
   * korunuyor — okunmakta olan bir ipucu kendi kendine kaybolmamalı.
   */
  const previous = useRef<{
    deviceId: string;
    span: number;
    to: number;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    epoch.current += 1;
    const mine = epoch.current;

    const before = previous.current;
    const silent =
      before !== null &&
      before.deviceId === deviceId &&
      before.span === spanMs &&
      before.nonce === reloadNonce &&
      toMs > before.to;
    previous.current = { deviceId, span: spanMs, to: toMs, nonce: reloadNonce };

    if (!silent) {
      setLoading(true);
      setHoverTime(null);
    }

    fetchBuckets({ deviceId, fromMs, toMs })
      .then((rows) => {
        if (mine !== epoch.current) return;
        setBuckets(rows);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine !== epoch.current) return;
        /*
         * Sessiz turda hata YUTULUYOR: kenar kendi kendine ilerledi, kullanıcı
         * bir şey istemedi. Geçici bir ağ hatası yüzünden okunmakta olan
         * grafiği silip yerine kırmızı bir satır koymak, kullanıcının kendi
         * yapmadığı bir işlemin cezasını çekmesi olurdu. Bir sonraki tur
         * zaten yeniden deniyor; gerçekten kopmuş bir bağlantıda WebSocket de
         * düşeceği için "Live" rozeti sönüyor.
         */
        if (silent) return;
        setBuckets([]);
        setError(errorMessage(e));
      })
      .finally(() => {
        if (mine === epoch.current && !silent) setLoading(false);
      });

    if (!showCrashes) return;

    /*
     * Çöküş kayıtları AYRI bir istek ve ayrı bir hata yolu: iki sorgunun
     * ortak bir Promise.all'da toplanması, birinin başarısızlığında diğerinin
     * hazır sonucunu da çöpe atardı. Grafiğin okunabilmesi için çöküş
     * kayıtlarına ihtiyaç yok; tersi de doğru. Aynı `epoch` bekçisini
     * paylaşıyorlar, çünkü ikisi de aynı pencereye ait.
     */
    if (!silent) setCrashLoading(true);
    fetchCrashSnapshots({ deviceId, fromMs, toMs })
      .then(({ rows, truncated }) => {
        if (mine !== epoch.current) return;
        setCrashes(rows);
        setCrashTruncated(truncated);
      })
      .catch(() => {
        if (mine !== epoch.current || silent) return;
        setCrashes([]);
        setCrashTruncated(false);
      })
      .finally(() => {
        if (mine === epoch.current && !silent) setCrashLoading(false);
      });
    /*
     * `reloadNonce` bağımlılıklarda: yenile düğmesi cihaz listesini
     * tazeliyordu ama grafik penceresi değişmediği için bu efekt hiç
     * çalışmıyor, kullanıcı düğmeye basıp aynı grafiğe bakmaya devam
     * ediyordu. Sayaç yalnızca düğmeye basıldığında arttığı için kendi
     * başına gereksiz bir çekim de yaratmıyor.
     */
  }, [deviceId, fromMs, toMs, spanMs, showCrashes, reloadNonce]);

  /* --- sürükleyerek seçme (§9.8) ---------------------------------------- */

  /**
   * Seçimin ref kopyası. Bitirme dinleyicisi bir kez kuruluyor (her fare
   * hareketinde sökülüp takılmasın diye) ve kurulduğu andaki `drag`'i
   * kapatıyor; son değeri ref'ten okuyor.
   */
  const dragRef = useRef<Drag | null>(null);

  const startDrag = useCallback((t: number) => {
    dragRef.current = { from: t, to: t };
    setDrag(dragRef.current);
  }, []);

  const moveDrag = useCallback((t: number) => {
    if (!dragRef.current) return;
    dragRef.current = { from: dragRef.current.from, to: t };
    setDrag(dragRef.current);
  }, []);

  const dragging = drag !== null;

  /*
   * Seçim boyunca canlı kenar DONUYOR.
   *
   * Seçimin iki ucu mutlak zaman olarak tutuluyor, yani eksen kaysa bile
   * sonuçta doğru aralık yakınlaşırdı — ama kullanıcı bunu göremezdi: çizdiği
   * dikdörtgen parmağının altından sola kayardı. Tutamacı bırakmak temizlik
   * fonksiyonunun işi; sürükleme nasıl biterse bitsin (fare bırakma, Escape,
   * bileşenin sökülmesi) kenar mutlaka serbest kalıyor.
   */
  useEffect(() => {
    if (!dragging) return;
    return holdLive();
  }, [dragging, holdLive]);

  useEffect(() => {
    if (!dragging) return;

    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };

    /*
     * Dinleyici GRAFİKTE değil window'da: kullanıcı sürüklerken imleci
     * paneldan dışarı çıkarıp orada bırakabilir. Grafiğe bağlı olsaydı fare
     * tuşu bırakıldığı hâlde seçim ekranda asılı kalırdı ve bir sonraki
     * hareket onu yeniden sürüklemeye başlardı.
     */
    const finish = () => {
      const d = dragRef.current;
      cancel();
      if (d && Math.abs(d.to - d.from) >= spanMs * MIN_DRAG_FRACTION) {
        zoomTo(d.from, d.to);
      }
    };

    // Escape vazgeçirir — yarım kalmış bir seçimden çıkmanın klavyedeki
    // karşılığı bu ve §9.10'daki "refleks tuşu güvenli tarafa düşer"
    // kuralıyla aynı yönde.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };

    window.addEventListener("mouseup", finish);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, spanMs, zoomTo]);

  /* --- türetilenler ------------------------------------------------------ */

  const hardware = useMemo(
    () => hardwareTracks(buckets, ramTotalMb, widthMs),
    [buckets, ramTotalMb, widthMs],
  );

  const network = useMemo(
    () => networkTracks(buckets, widthMs),
    [buckets, widthMs],
  );

  const netCeiling = useMemo(
    () => tracksCeiling(network.tracks),
    [network.tracks],
  );

  const hoverIndex = useMemo(
    () => (hoverTime == null ? null : nearestIndex(buckets, hoverTime)),
    [hoverTime, buckets],
  );

  const onHoverTime = useCallback((t: number | null) => setHoverTime(t), []);

  const hovered = hoverIndex == null ? null : buckets[hoverIndex];

  /*
   * RAM izi eksikse SEBEBİ yazılıyor. Sessizce iki çizgi çizmek, kullanıcının
   * makinesinde RAM ölçümü olmadığını sanmasına yol açardı; asıl sebep
   * envanterin hiç gelmemiş olması, yani tavanın bilinmemesi.
   */
  const hardwareNote =
    ramTotalMb == null || ramTotalMb <= 0
      ? "Memory is not plotted yet: this host has not reported its inventory, so the total is unknown."
      : null;

  /**
   * Eksenin sağ ucu — kural lib/metrics.ts'te, burada yalnızca çağrılıyor.
   * Sayfadaki İKİ grafik de (ve ileride eklenecek her grafik) aynı yerde
   * bitsin diye: uçları farklı olan grafikler, aynı eksende sanılırken yalan
   * söylerdi.
   */
  const plotToMs = plotEndMs(toMs, spanMs, !locked);

  const shared = {
    buckets,
    fromMs,
    toMs,
    plotToMs,
    hoverIndex,
    onHoverTime,
    dragFrom: drag?.from ?? null,
    dragTo: drag?.to ?? null,
    onDragStart: startDrag,
    onDragMove: moveDrag,
  };

  const control =
    "inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 font-medium text-muted transition hover:border-accent/50 hover:text-fg";

  const title = heading ?? "Timeline";

  return (
    <section className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <IconActivity className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-medium">
            {href ? (
              <Link href={href} className="transition hover:text-accent">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          {/*
            §9.6 madde 5 — ZORUNLU. Seyreltilmiş bir grafik, seyreltildiğini
            söylemezse sessizce yalan söylemiş olur: kullanıcı ham veriye
            baktığını sanar. Başlığın hemen altında, çünkü okunması grafiğe
            bakmadan ÖNCE gerekiyor.
          */}
          <p className="mt-0.5 text-xs text-faint">
            Each point = {formatDuration(widthMs)} · band is min–max, line is
            the average
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <LiveLock connected={liveConnected} />
          {hovered && (
            <p className="text-right text-xs tabular-nums">
              <span className="text-fg">
                {axisTime(Date.parse(hovered.bucket_start), spanMs)}
              </span>
              <span className="block text-faint">
                {hovered.samples} samples
              </span>
            </p>
          )}
        </div>
      </header>

      {/*
        Yakınlaştırma çubuğu. Yakınlaşılmamışken de duruyor, çünkü sürükleyerek
        seçmenin GÖRÜNÜR bir işareti yok: kullanıcı deneyip keşfetmedikçe böyle
        bir yeteneğin varlığından haberi olmaz. Çubuğun her iki hâlde de yer
        kaplaması, yakınlaşınca sayfanın zıplamasını da önlüyor.
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg-soft/40 px-5 py-2 text-xs">
        {zoomDepth === 0 ? (
          <p className="flex items-center gap-1.5 text-faint">
            <IconZoom className="size-3.5 shrink-0" />
            Drag across the chart to zoom in — the selection narrows the log
            list too.
          </p>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-accent">
              <IconZoom className="size-3.5 shrink-0" />
              Zoomed in
            </span>
            <span className="tabular-nums text-muted">
              {axisTime(fromMs, spanMs)} – {axisTime(toMs, spanMs)} ·{" "}
              {formatDuration(spanMs)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={zoomBack} className={control}>
                <IconArrowLeft className="size-3.5" />
                Back
              </button>
              <button onClick={zoomReset} className={control}>
                <IconExpand className="size-3.5" />
                Reset
              </button>
            </div>
          </>
        )}
      </div>

      {/*
        Çöküş işaretleri grafiklerin üstünde (§9.4). Ölçüm olmasa BİLE
        duruyor: bir çöküş kaydı varken grafiğin boş kalması mümkün (kayıt
        acil flush ile gelir, o aralıkta metrik henüz seyrelme eşiğine
        ulaşmamış olabilir) ve o durumda işaretin kaybolması, elimizdeki tek
        kanıtı gizlemek olurdu.
      */}
      {showCrashes && !error && (
        <CrashMarkers
          snapshots={crashes}
          truncated={crashTruncated}
          loading={crashLoading}
          fromMs={fromMs}
          toMs={toMs}
          plotToMs={plotToMs}
        />
      )}

      {error && (
        <p className="px-5 py-12 text-center text-sm text-danger">
          Could not read the chart: {error}
        </p>
      )}

      {!error && loading && buckets.length === 0 && (
        <div className="space-y-4 p-5">
          <div className="h-[260px] animate-pulse rounded-lg bg-panel-2" />
          <div className="h-[180px] animate-pulse rounded-lg bg-panel-2" />
        </div>
      )}

      {!error && !loading && buckets.length === 0 && (
        <p className="px-5 py-16 text-center text-sm text-muted">
          No samples in this range.
        </p>
      )}

      {!error && buckets.length > 0 && (
        <>
          <MetricChart
            {...shared}
            tracks={hardware}
            /* Yüzde ekseninin tavanı SABİT 100 — veriden türetilseydi %12'de
               gezinen bir makine, ekseni 14'e çekip tepeye dayanmış gibi
               görünürdü. Sabit tavan "bu makine rahat" bilgisini koruyor. */
            ceiling={100}
            formatAxis={(v) => formatPercent(v)}
            note={hardwareNote}
          />

          {/* Ağ grafiği ayrı bir bölme: başlığı olmasaydı iki grafik tek bir
              şeymiş gibi okunur, ikinci eksenin farklı birimde olduğu gözden
              kaçardı. */}
          <div className="border-t border-line">
            <div className="flex items-baseline gap-2 px-5 pt-4">
              <h3 className="text-sm font-medium">Network</h3>
              <span className="text-[11px] text-faint">
                traffic in and out of this host
              </span>
            </div>
            {network.tracks.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">
                No network samples in this range.
              </p>
            ) : (
              <MetricChart
                {...shared}
                tracks={network.tracks}
                ceiling={netCeiling}
                formatAxis={(v) => formatBitrate(v, network.scale)}
                height={180}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
