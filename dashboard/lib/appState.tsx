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
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchDevices, type Device } from "./devices";
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

  /** Hazır düğmelerin çizdiği pencere; yakınlaştırma bunun içinde yaşar. */
  const base = useMemo<TimeWindow>(() => {
    const seconds =
      RANGES.find((r) => r.key === range)?.seconds ?? RANGES[0].seconds;
    return { from: anchor - seconds * 1000, to: anchor };
  }, [range, anchor]);

  // Adı bilerek `timeWindow`: `window` global nesneyi gölgeler ve bu değeri
  // kullanan bileşenlerden biri (Timeline) window seviyesinde olay dinliyor.
  const timeWindow =
    zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : base;

  /**
   * Aralık değişince yığın BOŞALIR. Kaba ayar ince ayarı geçersiz kılar:
   * kullanıcı "10 gün"e bastığında 10 gün görmeyi bekler, iki gün önce
   * seçtiği üç dakikalık pencerenin içinden süzülmüş bir 10 günü değil.
   */
  const setRange = useCallback((key: RangeKey) => {
    setRangeState(key);
    setAnchor(Date.now());
    setZoomStack([]);
  }, []);

  const zoomTo = useCallback(
    (from: number, to: number) => {
      setZoomStack((stack) => {
        const current = stack.length > 0 ? stack[stack.length - 1] : base;

        // Sürükleme sağdan sola da yapılabilir; seçim yönü bir bilgi taşımıyor.
        let lo = Math.max(Math.min(from, to), current.from);
        let hi = Math.min(Math.max(from, to), current.to);

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

        // Pencereyi daraltmayan bir seçim yığına girmemeli: "geri" düğmesi
        // aynı görüntüye dönen boş bir adım biriktirirdi.
        if (hi - lo >= current.to - current.from) return stack;
        return [...stack, { from: lo, to: hi }];
      });
    },
    [base],
  );

  const zoomBack = useCallback(() => {
    setZoomStack((stack) => stack.slice(0, -1));
  }, []);

  const zoomReset = useCallback(() => setZoomStack([]), []);

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
      email,
      accountId,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
