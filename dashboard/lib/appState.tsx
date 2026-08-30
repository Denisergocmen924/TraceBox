/**
 * Kabuğun (sidebar + toolbar) ve sayfaların paylaştığı tek durum.
 *
 * Neden context: sidebar cihaz listesini gösteriyor, toolbar aynı listeden
 * uyarı sayısını türetiyor, cihaz listesi sayfası aynı listeyi kartlara
 * çiziyor. Üçü ayrı ayrı sorgu açsaydı aynı satırlar üç kez inerdi ve üçü
 * birbirinden birkaç saniye farklı bir "şu an"a bakardı — sidebar bir cihazı
 * çevrimiçi gösterirken kart çevrimdışı diyebilirdi.
 *
 * Arama kutusu ve zaman aralığı da burada: ikisi de TOOLBAR'da duruyor ama
 * içeriği SAYFA çiziyor. Aradaki tek bağ bu nesne.
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

type AppValue = {
  devices: Device[] | null;
  error: string | null;
  /** Saniyede bir tikleyen "şu an" — "12 saniye önce" ve çevrimdışı rozeti. */
  now: number;
  refreshing: boolean;
  reload: () => void;
  query: string;
  setQuery: (value: string) => void;
  range: RangeKey;
  setRange: (key: RangeKey) => void;
  /**
   * Aralığın SABİTLENDİĞİ an — saniyede bir tikleyen `now` değil. O olsaydı
   * pencerenin iki ucu da her saniye kayar, grafik ve log listesi durmadan
   * yeniden çekilirdi. Yalnızca kullanıcı aralığı değiştirdiğinde tazelenir.
   */
  anchor: number;
  rangeSeconds: number;
  email: string;
};

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(Ctx);
  // Sağlayıcı dışında çağrılırsa sessizce undefined dönmek yerine patlıyor:
  // aksi hâlde hata, aylar sonra "cihazlar niye boş" diye görünürdü.
  if (!value) throw new Error("useApp, AppProvider dışında çağrıldı");
  return value;
}

export function AppProvider({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRangeState] = useState<RangeKey>("24h");
  const [anchor, setAnchor] = useState(() => Date.now());

  const setRange = useCallback((key: RangeKey) => {
    setRangeState(key);
    setAnchor(Date.now());
  }, []);

  const load = useCallback(async () => {
    try {
      setDevices(await fetchDevices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  const rangeSeconds =
    RANGES.find((r) => r.key === range)?.seconds ?? RANGES[0].seconds;

  const value = useMemo<AppValue>(
    () => ({
      devices,
      error,
      now,
      refreshing,
      reload,
      query,
      setQuery,
      range,
      setRange,
      anchor,
      rangeSeconds,
      email,
    }),
    [
      devices,
      error,
      now,
      refreshing,
      reload,
      query,
      range,
      setRange,
      anchor,
      rangeSeconds,
      email,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
