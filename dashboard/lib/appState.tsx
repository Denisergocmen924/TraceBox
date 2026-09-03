/**
 * Kabuğun (sidebar + toolbar) ve sayfaların paylaştığı tek durum.
 *
 * Neden context: sidebar cihaz listesini gösteriyor, toolbar aynı listeden
 * uyarı sayısını türetiyor, cihaz listesi sayfası aynı listeyi kartlara
 * çiziyor. Üçü ayrı ayrı sorgu açsaydı aynı satırlar üç kez inerdi ve üçü
 * birbirinden birkaç saniye farklı bir "şu an"a bakardı — sidebar bir cihazı
 * çevrimiçi gösterirken kart çevrimdışı diyebilirdi.
 *
 * Arama kutusu ve ZAMAN PENCERESİ de burada. Pencere özellikle önemli: §9.8
 * "zaman aralığı TEKTİR" diyor — grafikteki seçim log listesini de daraltıyor.
 * İki bileşen ayrı ayrı pencere tutsaydı bağ kurulamazdı; kullanıcı grafikte
 * bir sıçrama görüp loglara baktığında zaman damgalarını gözüyle eşleştirmek
 * zorunda kalırdı.
 *
 * Pencerenin CANLI KENARI da burada, aynı sebeple. Grafik kendi kenarını
 * kaydırsaydı §9.8'in tek aralık kuralı kırılırdı: grafik son beş dakikayı
 * gösterirken log listesi hâlâ sayfa açıldığı andaki pencerede kalırdı ve
 * yakınlaştırma o kaymayı hesaba katmadan kırpardı. Kenar burada olduğu için
 * sayfadaki HER panel aynı "şu an"a bakıyor ve tek bir abonelik yetiyor —
 * grafik başına bir kanal açmak, Metrics sayfasında cihaz sayısı kadar
 * WebSocket demekti.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchDevices, type Device } from "./devices";
import { BUCKET_COUNT } from "./metrics";
import { subscribeMetrics } from "./realtime";
import { RANGES, type RangeKey } from "./logs";
import { errorMessage } from "./errors";

/**
 * Liste 10 saniyede bir yenilenir — agent'ın komut poll'u ile aynı ritim.
 * Daha sık sormanın anlamı yok: last_seen zaten en fazla o kadar tazeleniyor.
 *
 * Burada Realtime KULLANILMIYOR. Realtime, son 24 saatin logları için ayrıldı
 * (§9.9); orada gecikme ürünün vaadinin parçası. Listede "12 saniye önce"
 * yazısının bir saniye geç güncellenmesi kimseyi ilgilendirmez, buna karşılık
 * her cihaz için ayrı bir abonelik açmak gerekirdi.
 */
const REFRESH_MS = 10_000;

/**
 * Canlı kenarın ilerleyebileceği en sık aralık — §9.9'un zorunlu kıldığı
 * "ekran saniyede en fazla bir kez güncellenir" tavanı.
 *
 * Tek başına yeterli değil, alt sınır olarak kullanılıyor: asıl adım bir KOVA
 * genişliği (aşağıda). Bir kovadan az kaydırmak grafiği değiştirmez — aynı
 * resmi yeniden indirmek olurdu.
 */
const LIVE_TICK_MS = 1000;

/** İncelenen zaman aralığı. İki ucu da mutlak an (epoch ms). */
export type TimeWindow = { from: number; to: number };

/**
 * En dar yakınlaştırma: bir dakika.
 *
 * Alt sınır olmasaydı iki piksellik kazara bir sürükleme, içinde tek bir ölçüm
 * bile olmayan üç saniyelik bir pencere açardı — kullanıcı boş bir grafiğe
 * bakıp veri kaybettiğini sanardı. Bir dakika, agent'ın 5 saniyelik ölçüm
 * adımının 12 katı: bu genişlikte kovalar ham örneklerin altına iniyor, yani
 * §9.6 madde 2'nin istediği gibi ekranda artık ÖZET değil cihazın gerçekten
 * gönderdiği sayılar duruyor.
 */
export const MIN_ZOOM_MS = 60_000;

/**
 * Sürükleyerek yapılan seçimin sağ ucu, pencerenin sağ ucuna "değmiş" sayıldığı
 * pay — pencere genişliğinin oranı olarak.
 *
 * Tam eşitlik aramak fazla katı olurdu: canlı kalmak isteyen kullanıcının bir
 * pikselle geride bıraktığı sürükleme sessizce kilitlenirdi. Yüzde iki, bir
 * saatlik pencerede ~72 saniye — grafiğin sağ ucundaki boş paya (RIGHT_GUTTER)
 * kadar sürükleyen herkesi kapsıyor.
 */
const LIVE_EDGE_TOLERANCE = 0.02;

type AppValue = {
  devices: Device[] | null;
  error: string | null;
  /** Saniyede bir tikleyen "şu an" — "12 saniye önce" ve çevrimdışı rozeti. */
  now: number;
  refreshing: boolean;
  reload: () => void;
  /**
   * Elle yenilemede artan sayaç.
   *
   * Cihaz listesi 10 saniyede bir kendiliğinden tazeleniyor ama Overview'ın
   * grafiği ve son log listesi ayrı sorgular; onları da 10 saniyede bir
   * çekmek, penceresi zaten DONDURULMUŞ (anchor) bir grafiği durmadan yeniden
   * indirmek olurdu. Bunun yerine yenile düğmesine bağlılar: `devices` dizisi
   * her turda yeni bir nesne olduğu için ona bağımlılık kurmak da aynı israfı
   * yapardı, sayaç ise yalnızca kullanıcı istediğinde değişiyor.
   */
  reloadNonce: number;
  /**
   * Üst çubuktaki "All Hosts" seçicisi (referans 2). `null` = hepsi.
   *
   * Yerini aldığı şey bir arama kutusuydu; referansta arama yok, seçici var.
   * Seçici aslında daha keskin: cihaz sayısı avuç içi kadar olduğu için
   * serbest metinle aramak, listeden seçmekten hiçbir zaman hızlı olmuyordu.
   * Overview'da KPI'ları ve grafiği, cihaz listesinde kartları daraltıyor.
   */
  hostFilter: string | null;
  setHostFilter: (id: string | null) => void;

  /* --- zaman penceresi (§9.5 + §9.8) ------------------------------------ */

  /** Kaba ayar: toolbar'daki hazır aralık düğmeleri. */
  range: RangeKey;
  setRange: (key: RangeKey) => void;
  /** İnce ayar sonrası ekranda GERÇEKTEN görünen aralık. */
  timeWindow: TimeWindow;
  /** Kaç kez yakınlaşıldı. 0 ise "geri" ve "sıfırla" düğmeleri gösterilmez. */
  zoomDepth: number;
  zoomTo: (from: number, to: number) => void;
  zoomBack: () => void;
  zoomReset: () => void;
  /**
   * Metrik kanalı GERÇEKTEN kurulu mu (§9.6 madde 5). Grafikteki "Live"
   * rozetini bu belirliyor: kanal koptuğunda rozeti yanık bırakmak,
   * kullanıcıya makinenin veri üretmediğini söylemek olurdu.
   */
  liveConnected: boolean;
  /**
   * Canlı kenarı geçici olarak dondurur; dönen fonksiyon serbest bırakır.
   *
   * Sürükleyerek seçim (§9.8) için şart: seçim mutlak zamanla tutuluyor ama
   * eksen kayınca aynı anın PİKSELİ kayar, yani kullanıcının çizdiği dikdörtgen
   * parmağının altından kaçardı. Sayaç (tek bayrak değil) çünkü Metrics
   * sayfasında birden çok grafik var ve biri bırakırken öteki hâlâ tutuyor
   * olabilir.
   */
  holdLive: () => () => void;
  /**
   * Kilit. Açıkken (`false`) pencere CANLI: sağ ucu "şu an"da duruyor ve yeni
   * veri geldikçe ilerliyor — yakınlaştırılmış hâlde bile. Kapalıyken (`true`)
   * ekrandaki her şey donuyor: ne eksen kayıyor, ne log listesine satır
   * düşüyor.
   *
   * Neden tek ve PAYLAŞILAN bir bayrak: §9.8 zaman aralığının tek olmasını
   * istiyor. Grafik canlı akarken log listesi donuk kalsaydı ikisi aynı
   * aralığa bakmayı bırakırdı ve grafikteki sıçramanın logu listede hiç
   * görünmezdi.
   *
   * Değişmez kural: KİLİT AÇIKSA PENCERE "ŞU AN"DA BİTER. Geçmişte bir anı
   * çerçeveleyen bir seçim kilidi kendiliğinden kapatıyor (`zoomTo`), kilidi
   * elle açmak ise pencereyi genişliğini koruyarak bugüne getiriyor.
   */
  locked: boolean;
  toggleLock: () => void;

  email: string;
  /**
   * accounts.id = auth.users.id (CLAUDE.md §5). commands satırı eklerken
   * account_id kolonu bununla doldurulur; RLS (`ins_commands`) hem bu değerin
   * auth.uid()'e eşit olmasını hem de cihazın aynı hesaba ait olmasını arıyor.
   */
  accountId: string;
};

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(Ctx);
  // Sağlayıcı dışında çağrılırsa sessizce undefined dönmek yerine patlıyor:
  // aksi hâlde hata, aylar sonra "cihazlar niye boş" diye görünürdü.
  if (!value) throw new Error("useApp was called outside AppProvider");
  return value;
}

export function AppProvider({
  email,
  accountId,
  children,
}: {
  email: string;
  accountId: string;
  children: React.ReactNode;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [hostFilter, setHostFilter] = useState<string | null>(null);
  const [range, setRangeState] = useState<RangeKey>("1h");
  /**
   * Aralığın SABİTLENDİĞİ an — saniyede bir tikleyen `now` değil. O olsaydı
   * pencerenin iki ucu da her saniye kayar, grafik ve log listesi durmadan
   * yeniden çekilirdi. Yalnızca kullanıcı aralığı değiştirdiğinde tazelenir.
   */
  const [anchor, setAnchor] = useState(() => Date.now());
  /**
   * Yakınlaştırma YIĞIN, tek pencere değil: §9.8 "geri" düğmesi istiyor ve
   * geri gitmek ancak nereden gelindiği hatırlanırsa mümkün. Tek pencere
   * tutulsaydı "geri" yalnızca en başa dönebilirdi — yani "sıfırla" ile aynı
   * düğme olurdu.
   */
  const [zoomStack, setZoomStack] = useState<TimeWindow[]>([]);

  /**
   * Pencerenin canlı sağ kenarı. `null` = kenar `anchor`da duruyor (henüz yeni
   * veri gelmedi ya da canlı akış kapalı).
   *
   * Ayrı bir durum, `anchor`ın üzerine yazmak yerine: `anchor` kullanıcının
   * SEÇTİĞİ an, kenar ise verinin getirdiği an. İkisini tek değişkende
   * toplasaydık "sıfırla" nereye döneceğini bilemezdi.
   */
  const [liveEdge, setLiveEdge] = useState<number | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  /**
   * Kilit kapalı BAŞLAMIYOR: kara kutuya bakmanın varsayılan hâli "şu an ne
   * oluyor" — donmuş bir ekranı kullanıcıya açtırtmak, ilk bakışta ürünün
   * canlı olmadığını söylemek olurdu.
   */
  const [locked, setLocked] = useState(false);
  const toggleLock = useCallback(() => setLocked((v) => !v), []);

  // Zamanlayıcı kenarı state'ten okuyamaz (kurulduğu render'ın kopyasını
  // görürdü); ref gerçeğin kaynağı, state yalnızca çizim kopyası.
  const liveEdgeRef = useRef<number | null>(null);
  const setEdge = useCallback((value: number | null) => {
    liveEdgeRef.current = value;
    setLiveEdge(value);
  }, []);

  /** Kenarı donduran açık tutamaç sayısı (bkz. `holdLive`). */
  const holds = useRef(0);
  const holdLive = useCallback(() => {
    holds.current += 1;
    let released = false;
    // Aynı tutamacı iki kez bırakmak sayacı eksiye düşürür ve kenar bir daha
    // hiç donmazdı; React efekt temizliğini iki kez çağırabiliyor.
    return () => {
      if (released) return;
      released = true;
      holds.current -= 1;
    };
  }, []);

  /** Hazır düğmelerin çizdiği pencere; yakınlaştırma bunun içinde yaşar. */
  const base = useMemo<TimeWindow>(() => {
    const seconds =
      RANGES.find((r) => r.key === range)?.seconds ?? RANGES[0].seconds;
    // Pencere KAYIYOR, uzamıyor: iki uç birlikte ilerliyor. Yalnızca sağ ucu
    // ilerletseydik "son 1 saat" düğmesi bir saat sonra iki saat gösterirdi.
    const to = liveEdge ?? anchor;
    return { from: to - seconds * 1000, to };
  }, [range, anchor, liveEdge]);

  /** Yığının tepesi — henüz canlı kenara göre kaydırılmamış hâli. */
  const rawWindow =
    zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : base;

  // Adı bilerek `timeWindow`: `window` global nesneyi gölgeler ve bu değeri
  // kullanan bileşenlerden biri (Timeline) window seviyesinde olay dinliyor.
  const timeWindow = useMemo<TimeWindow>(() => {
    // `base` zaten kenarda bitiyor (yukarıda `to = liveEdge ?? anchor`), yani
    // kaydırılacak olan yalnızca YAKINLAŞTIRILMIŞ pencere. Kilitliyken kenar
    // zaten ilerlemiyor.
    if (locked || liveEdge === null || zoomStack.length === 0) return rawWindow;
    /*
     * Pencere KAYIYOR, uzamıyor — `base` ile aynı kural. Genişlik korunmasaydı
     * kullanıcının seçtiği çözünürlük ekranda kendiliğinden değişirdi.
     *
     * Geriye kaydırma YOK: kilit uzun süre kapalı kaldıysa kenar bayatlamış
     * olabilir ve negatif bir kaydırma pencereyi kimsenin istemediği bir
     * geçmişe iterdi. Kenar ilk metrik haberinde tek adımda bugüne geliyor.
     */
    const shift = Math.max(0, liveEdge - rawWindow.to);
    return shift === 0
      ? rawWindow
      : { from: rawWindow.from + shift, to: rawWindow.to + shift };
  }, [rawWindow, locked, liveEdge, zoomStack.length]);

  /**
   * Ekranda GERÇEKTEN duran pencerenin ref kopyası.
   *
   * `zoomTo` bunu okuyor, state'i değil: kilit açıkken pencere saniyede bir
   * kayıyor: callback ona bağımlı olsaydı her kaymada yeni bir kimlik alır ve
   * sürüklemeyi dinleyen efekt de her saniye sökülüp yeniden takılırdı.
   */
  const windowRef = useRef(timeWindow);
  windowRef.current = timeWindow;

  /**
   * Aralık değişince yığın BOŞALIR. Kaba ayar ince ayarı geçersiz kılar:
   * kullanıcı "10 gün"e bastığında 10 gün görmeyi bekler, iki gün önce
   * seçtiği üç dakikalık pencerenin içinden süzülmüş bir 10 günü değil.
   */
  const setRange = useCallback(
    (key: RangeKey) => {
      setRangeState(key);
      setAnchor(Date.now());
      setZoomStack([]);
      // Kenar da sıfırlanır: yeni `anchor` zaten "şimdi", eski kenarı taşımak
      // pencereyi geleceğe iterdi.
      setEdge(null);
      // Kilit de açılır: kaba ayara dönmek "baştan başla" demek ve kara
      // kutunun baştan başlama hâli canlıdır. Kilitli kalsaydı kullanıcı yeni
      // aralığı donmuş görür, sebebini de göremezdi — kilidi belki dakikalar
      // önce, başka bir ekranda kapatmıştı.
      setLocked(false);
    },
    [setEdge],
  );

  const zoomTo = useCallback((from: number, to: number) => {
    const current = windowRef.current;
    const span = current.to - current.from;

    // Sürükleme sağdan sola da yapılabilir; seçim yönü bir bilgi taşımıyor.
    let lo = Math.max(Math.min(from, to), current.from);
    let hi = Math.min(Math.max(from, to), current.to);

    /*
     * SEÇİMİN SAĞ UCU KİLİDİ BELİRLER.
     *
     * Sağ uca değen bir seçim "şu ana yakınlaş" demektir — kullanıcı akmakta
     * olan veriye bakıyor, yalnızca daha yakından. Geride bir yeri çerçeveleyen
     * seçim ise "şu ana ne olduğuna bak" demektir; oraya yeni veri akıtmak,
     * kullanıcının işaret ettiği olayı ekrandan kaydırırdı. İkinci hâlde kilit
     * KENDİLİĞİNDEN kapanıyor ve üst çubuktaki düğme bunu gösteriyor: kilidi
     * elle kapatmayı beklemek, kullanıcıya ihtiyacı olduğunu ancak seçimi
     * kaçırdıktan sonra öğreteceği bir kural olurdu.
     */
    const atEdge = current.to - hi <= span * LIVE_EDGE_TOLERANCE;
    // Pay kapatılıyor: kalsaydı yeni (ve çok daha dar) pencere ilk kaymada o
    // payın tamamı kadar sıçrardı — 1 saatlik pencerede göze çarpmayan 72
    // saniye, 2 dakikalık pencerede ekranın üçte biri eder.
    if (atEdge) hi = current.to;

    /*
     * Çok dar seçim SESSİZCE KIRPILMAZ, merkezi korunarak genişletilir.
     * Kırpmak kullanıcının işaret ettiği anı kaydırırdı; genişletmek onu
     * ortada tutup yalnızca çerçeveyi büyütüyor — nişan alınan yer aynı
     * kalıyor.
     */
    if (hi - lo < MIN_ZOOM_MS) {
      const center = (lo + hi) / 2;
      lo = center - MIN_ZOOM_MS / 2;
      hi = center + MIN_ZOOM_MS / 2;
      if (lo < current.from) {
        lo = current.from;
        hi = lo + MIN_ZOOM_MS;
      }
      if (hi > current.to) {
        hi = current.to;
        lo = hi - MIN_ZOOM_MS;
      }
    }

    // Pencereyi daraltmayan bir seçim yığına girmemeli: "geri" düğmesi aynı
    // görüntüye dönen boş bir adım biriktirirdi.
    if (hi - lo >= span) return;
    if (!atEdge) setLocked(true);
    setZoomStack((stack) => [...stack, { from: lo, to: hi }]);
  }, []);

  const zoomBack = useCallback(() => {
    // Kilide DOKUNULMUYOR: "geri" bir adım geri almak demek, canlıya dönmek
    // değil. Canlıya dönüş için kilit düğmesi ve "sıfırla" var.
    setZoomStack((stack) => stack.slice(0, -1));
  }, []);

  const zoomReset = useCallback(() => {
    setZoomStack([]);
    // "Sıfırla" varsayılan görüntüye döner; varsayılan görüntü canlıdır.
    setLocked(false);
  }, []);

  const load = useCallback(async () => {
    try {
      setDevices(await fetchDevices());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  /**
   * Elle yenileme, otomatik yenilemeden bir noktada ayrılıyor: dönen spinner.
   * Otomatik turda spinner göstermek toolbar'ı 10 saniyede bir kıpırdatır ve
   * göz oraya takılırdı; kullanıcı butona bastığında ise bir şey olduğunu
   * görmesi gerekiyor.
   */
  const reload = useCallback(() => {
    setRefreshing(true);
    setReloadNonce((n) => n + 1);
    load().finally(() => setRefreshing(false));
  }, [load]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  /* --- canlı kenar (§9.9) ------------------------------------------------ */

  /**
   * Canlı akışı yakınlaştırma değil, YALNIZCA kilit belirliyor.
   *
   * Eskiden kural `zoomStack.length === 0` idi: yakınlaşan kullanıcı canlıyı
   * da kaybediyordu. Oysa yakınlaşmanın iki ayrı sebebi var — "şu ana daha
   * yakından bak" ve "geçmişte şu ana bak" — ve ikincisini zaten `zoomTo`
   * kendisi tanıyıp kilidi kapatıyor. Kilit tek ve GÖRÜNÜR bir anahtar olduğu
   * için kullanıcı ekranın neden donduğunu da, nasıl çözüleceğini de görüyor.
   */
  const liveOn = !locked;

  /** Ekrandaki aralığın genişliği — kova adımı bundan türüyor (aşağıda).
      Pencere kaydıkça iki ucu birlikte ilerlediği için bu sayı DEĞİŞMİYOR;
      efektin bağımlılığı olarak pencerenin kendisi yerine bunu kullanmak,
      kenar her kaydığında aboneliğin sökülüp yeniden kurulmasını önlüyor. */
  const spanMs = timeWindow.to - timeWindow.from;

  useEffect(() => {
    if (!liveOn) {
      // Kenar SIFIRLANMIYOR, olduğu yerde bırakılıyor: yakınlaşmadan geri
      // dönen kullanıcı, bıraktığı görüntüye dönmeli. Sıfırlansaydı "geri"
      // düğmesi pencereyi sessizce geçmişe atardı — kullanıcının hiç
      // istemediği bir kayma. Uzun bir incelemeden sonra kenar bayatlamış
      // olabilir; ilk metrik haberinde tek adımda bugüne geliyor.
      setLiveConnected(false);
      return;
    }

    /*
     * Realtime burada VERİ KAYNAĞI değil, HABERCİ: gelen satır okunmuyor bile,
     * yalnızca "yeni bir şey var" bayrağı kalkıyor. Ekrandaki sayılar yine
     * metrics_buckets'tan geliyor, yani seyreltme tek yerde kalıyor
     * (lib/realtime.ts → subscribeMetrics).
     *
     * Bayrak, ilerletilemeyen turlarda DA duruyor: kenar donmuşken (sürükleme)
     * ya da adım henüz dolmamışken gelen haber unutulsaydı, o veri bir sonraki
     * satır gelene kadar ekrana hiç düşmezdi.
     */
    let pending = false;
    const stop = subscribeMetrics({
      onStatus: setLiveConnected,
      onInsert: () => {
        pending = true;
      },
    });

    /*
     * Adım = bir kova genişliği, en az bir saniye. Kovadan dar bir kayma
     * grafikte tek bir pikseli bile değiştiremez; o kaymayı uygulamak aynı
     * ~1000 noktayı yeniden indirmek olurdu. 1 saatlik pencerede kova 3,6
     * saniye, 10 günlükte 14 dakika — yani uzak görünümde kenar seyrek
     * ilerliyor, çünkü sık ilerlemesinin GÖRÜNÜR bir karşılığı yok.
     */
    const step = Math.max(LIVE_TICK_MS, spanMs / BUCKET_COUNT);

    const timer = setInterval(() => {
      if (!pending || holds.current > 0) return;
      const at = Date.now();
      const edge = liveEdgeRef.current;
      if (edge !== null && at - edge < step) return;
      pending = false;
      setEdge(at);
    }, LIVE_TICK_MS);

    return () => {
      stop();
      clearInterval(timer);
    };
  }, [liveOn, spanMs, setEdge]);

  const value = useMemo<AppValue>(
    () => ({
      devices,
      error,
      now,
      refreshing,
      reload,
      reloadNonce,
      hostFilter,
      setHostFilter,
      range,
      setRange,
      timeWindow,
      zoomDepth: zoomStack.length,
      zoomTo,
      zoomBack,
      zoomReset,
      liveConnected,
      holdLive,
      locked,
      toggleLock,
      email,
      accountId,
    }),
    [
      devices,
      error,
      now,
      refreshing,
      reload,
      reloadNonce,
      hostFilter,
      range,
      setRange,
      timeWindow,
      zoomStack.length,
      zoomTo,
      zoomBack,
      zoomReset,
      liveConnected,
      holdLive,
      locked,
      toggleLock,
      email,
      accountId,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
