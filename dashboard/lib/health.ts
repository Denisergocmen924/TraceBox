/**
 * Overview'ın veri katmanı — "kara kutu kayıt yapıyor mu?" (§9.11.2 üzeri).
 *
 * Bu dosya, Overview'ın ne olduğuna dair kararın kod tarafındaki karşılığı.
 * Eski Overview cihaz metriklerini ve loglarını gösteriyordu; ikisi de zaten
 * KENDİ sayfalarında (Metrics, Logs, Hosts) daha iyi duruyordu, yani ekran bir
 * özet değil bir tekrardı ve ekranı doldurmak için kaydırma gerektiriyordu.
 * Yerine geçen soru başka: makinenin CPU'su değil, SİSTEMİN kendisi çalışıyor
 * mu — veri agent'tan çıkıp veritabanına düşüyor mu, ne kadar gecikmeyle, kaç
 * kez acil gönderim tetiklendi ve elde kaç günlük kayıt var.
 *
 * Dürüstlük kuralı (§9.6 madde 5) burada da geçerli ve iki yerde görünüyor:
 *   - Ölçüm KAÇ ÖRNEKTEN çıktığı her zaman birlikte döner (`samples`), çünkü
 *     üç satırdan hesaplanmış bir medyan ile beş yüz satırdan çıkanı aynı
 *     yazı tipiyle göstermek sessizce yalan söylemek olur.
 *   - Kanıt yoksa durum "unknown"dır, "ok" değil. Sidebar'daki collector
 *     rozetinin kuralıyla aynı: hiç cihaz yokken "Healthy" demek bir şey
 *     KANITLAMAZ.
 *
 * Hiçbiri yeni migration istemiyor; hepsi mevcut RLS politikalarıyla
 * okunabilen sütunlardan türüyor (`sel_accounts`, `sel_metrics`, `sel_logs`,
 * `sel_crash`, `sel_devices`).
 */
import { deviceStatus, type Device } from "./devices";
import { supabase } from "./supabase";

/* --- Gecikme (ingest lag) ------------------------------------------------- */

/**
 * Kaç satırdan ölçülür.
 *
 * 500 satır, 5 saniyelik ölçüm adımıyla tek cihazda ~40 dakikalık bir pencere
 * demek — "şu an sistem ne kadar gecikmeli" sorusunu cevaplayacak kadar taze,
 * medyanın tek bir tıkanmadan sapmayacağı kadar geniş. Daha fazlası bu ekranda
 * hiçbir şeyi değiştirmeden indirme boyutunu büyütürdü.
 */
export const LAG_SAMPLE_LIMIT = 500;

export type IngestLag = {
  /** Ölçümün dayandığı satır sayısı — ekranda birlikte yazılır. */
  samples: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  /**
   * En son VARAN satırın damgası — veri yolunun son durağının kanıtı.
   *
   * Ayrı bir sorgu değil: liste zaten `received_at` azalan sıralı, yani ilk
   * satır tanımı gereği en yenisi. İkinci bir sorgu açmak aynı indeksi ikinci
   * kez okumak olurdu.
   */
  lastReceivedAt: string | null;
  /**
   * `received_at < measured_at` olan satır sayısı, yani NEGATİF gecikme.
   *
   * Fiziksel olarak imkânsız: veri varmadan ölçülemez. Görülüyorsa cihazın
   * saati sunucununkinden ileri demektir. Gizlenmiyor — gecikme rakamı bu
   * durumda anlamını yitirir ve kullanıcının bunu bilmesi gerekir.
   */
  skewed: number;
};

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  // En yakın sıra (nearest-rank): ara değer üretmiyor, dönen sayı gerçekten
  // ölçülmüş bir gecikme oluyor.
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Agent'ın ölçtüğü an ile sunucunun yazdığı an arasındaki fark.
 *
 * İki damga da zaten satırda duruyor (§5: `measured_at` agent, `received_at`
 * sunucu) — yani bu ölçüm için ne yeni bir sütun ne de bir migration gerekti.
 * Ölçüt olarak `metrics` seçildi çünkü tek düzenli akış o: loglar makine sessiz
 * kaldığında hiç üretilmeyebilir, metrik her tick'te üretilir.
 *
 * Sıralama `received_at` üzerinden: "en son VARAN" satırlar isteniyor.
 * `measured_at`'e göre sıralansaydı saati ileri kaçmış tek bir cihaz listeyi
 * kendi eski satırlarıyla doldururdu.
 */
export async function fetchIngestLag(params: {
  deviceId: string | null;
  limit?: number;
}): Promise<IngestLag> {
  let query = supabase()
    .from("metrics")
    .select("measured_at, received_at")
    .order("received_at", { ascending: false })
    .limit(params.limit ?? LAG_SAMPLE_LIMIT);

  if (params.deviceId) query = query.eq("device_id", params.deviceId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const deltas: number[] = [];
  let skewed = 0;

  for (const row of rows) {
    const measured = Date.parse(row.measured_at as string);
    const received = Date.parse(row.received_at as string);
    if (!Number.isFinite(measured) || !Number.isFinite(received)) continue;

    const delta = received - measured;
    if (delta < 0) {
      skewed += 1;
      continue; // saat kayması: dağılıma sokmak medyanı kirletirdi
    }
    deltas.push(delta);
  }

  deltas.sort((a, b) => a - b);

  return {
    lastReceivedAt: (rows[0]?.received_at as string | undefined) ?? null,
    samples: deltas.length,
    medianMs: percentile(deltas, 0.5),
    p95Ms: percentile(deltas, 0.95),
    maxMs: deltas.length > 0 ? deltas[deltas.length - 1] : 0,
    skewed,
  };
}

/* --- Acil gönderimler ----------------------------------------------------- */

/**
 * Listede en fazla kaç olay gösterilir. Toplam sayı ayrıca `total`da duruyor
 * (sunucu sayıyor), yani sınır yalnızca İNDİRİLEN satırı kısıtlıyor — ekrandaki
 * rakam kırpılmıyor.
 *
 * Dört, ekran yüksekliğinden geliyor: Overview'ın tamamı kaydırmasız sığmalı ve
 * bu liste satır sayısıyla doğrudan büyüyen tek bölüm. Kaç olayın gösterildiği
 * toplamdan azsa panel bunu ayrıca yazıyor.
 */
export const FLUSH_LIST_LIMIT = 4;

export type FlushEvent = {
  id: string;
  device_id: string;
  measured_at: string;
  /** cpu | ram | disk | log — agent'ı tetikleyen eşik (§4.2). */
  trigger_reason: string | null;
};

export type FlushEvents = {
  /** Penceredeki TOPLAM olay (sunucu sayar; `recent` kırpılmış olabilir). */
  total: number;
  /** Tetikleyiciye göre dağılım — hangi eşik patlıyor sorusunun cevabı. */
  byReason: Record<string, number>;
  recent: FlushEvent[];
};

/**
 * Acil gönderimler = `crash_snapshots` satırları.
 *
 * Bu tablo neden "kaç kez acil gönderim oldu"nun doğru ölçüsü: agent bir eşiği
 * aşınca (`flush.py`) her seferinde bir snapshot yazıyor — `crash_processes`
 * eklentisi KAPALI olsa bile satır oluşuyor, eklenti yalnızca `processes`
 * dizisini dolduruyor. Yani satır sayısı olayın kendisini sayıyor.
 *
 * Zaman ölçütü `measured_at`: kullanıcı "şu pencerede kaç kez tetiklendi" diye
 * soruyor, olayın makinede yaşandığı an bu. `received_at` retention'ın ölçütü
 * (§5); gecikmiş bir gönderimde ikisi saatlerce ayrışır.
 */
export async function fetchFlushEvents(params: {
  deviceId: string | null;
  fromMs: number;
  toMs: number;
  limit?: number;
}): Promise<FlushEvents> {
  let query = supabase()
    .from("crash_snapshots")
    .select("id, device_id, measured_at, trigger_reason", { count: "exact" })
    .gte("measured_at", new Date(params.fromMs).toISOString())
    .lte("measured_at", new Date(params.toMs).toISOString())
    .order("measured_at", { ascending: false })
    .limit(params.limit ?? FLUSH_LIST_LIMIT);

  if (params.deviceId) query = query.eq("device_id", params.deviceId);

  const { data, error, count } = await query;
  if (error) throw error;

  const recent = (data ?? []) as FlushEvent[];

  /*
   * Dağılım İNDİRİLEN satırlardan sayılıyor, penceredeki hepsinden değil —
   * yüzlerce satırı yalnızca gruplamak için indirmek pahalı olurdu. Bu yüzden
   * `byReason` toplamı `total`dan küçük olabilir; ekranda oran olarak değil,
   * son N olayın dökümü olarak sunulmalı.
   */
  const byReason: Record<string, number> = {};
  for (const row of recent) {
    const key = row.trigger_reason ?? "unknown";
    byReason[key] = (byReason[key] ?? 0) + 1;
  }

  return { total: count ?? recent.length, byReason, recent };
}

/* --- Saklama (retention) -------------------------------------------------- */

export type TableUsage = {
  /** Hesaba ait satır sayısı (RLS altında; yani yalnızca kendi verisi). */
  rows: number;
  /** En eski satırın varış anı — saklama penceresinin dolu kısmı. */
  oldestReceivedAt: string | null;
};

export type RetentionState = {
  /** accounts.retention_days — POLICY, kullanıcı değiştiremez (§5). */
  retentionDays: number;
  metrics: TableUsage;
  logs: TableUsage;
  crashes: TableUsage;
  /** Üç tablonun en eskisi — "kayıt ne kadar geriye gidiyor". */
  oldestReceivedAt: string | null;
  totalRows: number;
};

/** Hesap satırı okunamazsa varsayılan (şemadaki `default 10`). */
const DEFAULT_RETENTION_DAYS = 10;

/**
 * Tek tabloyu tek sorguda ölçer: satır sayısı + en eski varış.
 *
 * `count: "exact"` ile `limit(1)` aynı istekte birleşiyor — sayım sunucuda
 * yapılıyor, tarayıcıya tek satır iniyor. İkisi ayrı sorgu olsaydı iki kat
 * gidiş dönüş olurdu ve sayım ile en eski satır birbirinden birkaç saniye
 * farklı bir ana bakardı.
 *
 * Ölçüt `received_at`: retention da onunla siliyor (§5). `measured_at`
 * kullanılsaydı ekrandaki "en eski kayıt" ile cron'un sildiği satır farklı
 * olur, pencere dolu görünürken boşalabilirdi.
 */
async function tableUsage(
  table: "metrics" | "logs" | "crash_snapshots",
  deviceId: string | null,
): Promise<TableUsage> {
  let query = supabase()
    .from(table)
    .select("received_at", { count: "exact" })
    .order("received_at", { ascending: true })
    .limit(1);

  if (deviceId) query = query.eq("device_id", deviceId);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    rows: count ?? 0,
    oldestReceivedAt: (data?.[0]?.received_at as string | undefined) ?? null,
  };
}

export async function fetchRetention(params: {
  deviceId: string | null;
}): Promise<RetentionState> {
  const [account, metrics, logs, crashes] = await Promise.all([
    // `sel_accounts` yalnızca kendi satırını döndürüyor; filtre yazmaya gerek
    // yok (elle yazmak güvenlik eklemez, politikanın çalıştığı yanılsaması
    // yaratır — lib/devices.ts'teki aynı gerekçe).
    supabase().from("accounts").select("retention_days").limit(1).maybeSingle(),
    tableUsage("metrics", params.deviceId),
    tableUsage("logs", params.deviceId),
    tableUsage("crash_snapshots", params.deviceId),
  ]);

  if (account.error) throw account.error;

  const oldest = [
    metrics.oldestReceivedAt,
    logs.oldestReceivedAt,
    crashes.oldestReceivedAt,
  ]
    .filter((v): v is string => v != null)
    .sort();

  return {
    retentionDays:
      (account.data?.retention_days as number | undefined) ??
      DEFAULT_RETENTION_DAYS,
    metrics,
    logs,
    crashes,
    oldestReceivedAt: oldest[0] ?? null,
    totalRows: metrics.rows + logs.rows + crashes.rows,
  };
}

/* --- Veri yolu ------------------------------------------------------------ */

/**
 * Bir durağın durumu.
 *
 * `unknown` ayrı bir hâl olarak duruyor ve "ok"a çökmüyor: kanıt yoksa
 * söylenecek doğru şey "bilmiyorum". Hiç cihaz kaydı yokken Agent durağına
 * yeşil yakmak, kurulumu hiç yapmamış bir kullanıcıya sistemin çalıştığını
 * söylemek olurdu.
 */
export type HopState = "ok" | "warn" | "down" | "unknown";

export type Hop = {
  key: "agent" | "collector" | "database" | "dashboard";
  label: string;
  state: HopState;
  /** Durumun DAYANAĞI — hangi gözlemden çıktığı, tahmin değil. */
  detail: string;
};

/**
 * Bir satırın "taze" sayıldığı süre.
 *
 * Cihazın çevrimdışı eşiğiyle (60 sn) aynı değil, bilerek daha geniş: burada
 * ölçülen tek bir makinenin sessizliği değil, YOLUN kendisi. Gönderim aralığı
 * 30 saniyeye kadar çıkabiliyor (§4.3) ve bir batch'in yolda geçirdiği süre de
 * var; üç dakika, "yol kesildi" demeden önce birkaç turluk pay bırakıyor.
 */
export const PIPELINE_FRESH_MS = 180_000;

/**
 * Dört durağın canlı hâli: Agent → Collector → Database → Dashboard.
 *
 * Her durağın rengi bir GÖZLEMDEN çıkıyor, bir sağlık ucundan değil — ne
 * collector'ın ne de agent'ın dashboard'a durum bildiren bir kanalı var (§9.1:
 * dashboard collector'a okuma isteği YAPMAZ). Elde ne varsa ondan çıkarılıyor:
 *
 *   Agent      → devices.last_seen. Agent 10 saniyede bir komut soruyor ve her
 *                soruş bu damgayı tazeliyor; yani taze bir damga "agent ayakta
 *                ve collector'a ulaşabiliyor" demek.
 *   Collector  → aynı damga, ters yönden okunuyor: last_seen'i YAZAN collector.
 *                Damga tazeyse collector isteği almış ve veritabanına yazmış.
 *   Database   → en son VARAN satırın `received_at`i. Bu damgayı Postgres'in
 *                kendisi (`default now()`) koyuyor, yani satırın gerçekten
 *                yazıldığının kanıtı.
 *   Dashboard  → bu sorguların dönmüş olması. Okuma yolu RLS'in altından
 *                geçtiği için, veri geldiyse oturum ve politika da çalışıyor.
 *
 * Duraklatılmış cihaz "down" saymıyor: pause'da gönderim durur ama komut poll'ü
 * SÜRER (§7), yani last_seen tazelenmeye devam eder. Yol sağlam, akış kapalı.
 */
export function dataPath(params: {
  devices: Device[] | null;
  now: number;
  error: string | null;
  lastReceivedAt: string | null;
}): Hop[] {
  const { devices, now, error, lastReceivedAt } = params;

  const dashboard: Hop = error
    ? { key: "dashboard", label: "Dashboard", state: "down", detail: error }
    : devices == null
      ? {
          key: "dashboard",
          label: "Dashboard",
          state: "unknown",
          detail: "Loading",
        }
      : {
          key: "dashboard",
          label: "Dashboard",
          state: "ok",
          detail: "Reading over RLS",
        };

  // Okuma yolu kırıksa öndeki durakların durumu hakkında hiçbir şey
  // bilinmiyor: "down" demek yolu suçlamak olurdu, oysa kör olan biziz.
  if (devices == null || error) {
    const blind: HopState = "unknown";
    return [
      { key: "agent", label: "Agent", state: blind, detail: "No data" },
      { key: "collector", label: "Collector", state: blind, detail: "No data" },
      { key: "database", label: "Database", state: blind, detail: "No data" },
      dashboard,
    ];
  }

  if (devices.length === 0) {
    return [
      { key: "agent", label: "Agent", state: "unknown", detail: "No hosts" },
      {
        key: "collector",
        label: "Collector",
        state: "unknown",
        detail: "Nothing to receive",
      },
      {
        key: "database",
        label: "Database",
        state: "unknown",
        detail: "No rows yet",
      },
      dashboard,
    ];
  }

  const reporting = devices.filter(
    (d) => deviceStatus(d, now) !== "offline",
  ).length;

  const agent: Hop =
    reporting === devices.length
      ? {
          key: "agent",
          label: "Agent",
          state: "ok",
          detail: `${reporting} of ${devices.length} reporting`,
        }
      : reporting > 0
        ? {
            key: "agent",
            label: "Agent",
            state: "warn",
            detail: `${reporting} of ${devices.length} reporting`,
          }
        : {
            key: "agent",
            label: "Agent",
            state: "down",
            detail: "All hosts silent",
          };

  const collector: Hop =
    reporting > 0
      ? {
          key: "collector",
          label: "Collector",
          state: "ok",
          detail: "Accepting writes",
        }
      : {
          key: "collector",
          label: "Collector",
          state: "unknown",
          detail: "No recent request",
        };

  const receivedMs = lastReceivedAt ? Date.parse(lastReceivedAt) : NaN;
  const database: Hop = !Number.isFinite(receivedMs)
    ? {
        key: "database",
        label: "Database",
        state: "unknown",
        detail: "No rows yet",
      }
    : now - receivedMs <= PIPELINE_FRESH_MS
      ? {
          key: "database",
          label: "Database",
          state: "ok",
          detail: "Rows landing",
        }
      : {
          key: "database",
          label: "Database",
          state: "warn",
          detail: "No recent rows",
        };

  return [agent, collector, database, dashboard];
}

/* --- Biçimlendirme -------------------------------------------------------- */

/**
 * Gecikmeyi okunur tek bir sayıya çevirir: 820 ms · 4.2 s · 3.5 min.
 *
 * Birim ölçeği DEĞİŞİYOR çünkü gecikme üç büyüklük mertebesinde gezinebiliyor:
 * sağlıklı bir sistemde saniyenin altı, spool boşalırken dakikalar. Hepsini
 * saniye cinsinden yazmak ("0.82 s" ile "212 s") ikisini de zor okunur yapardı.
 */
export function formatLag(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

/**
 * Sağlıklı sayılan gecikme tavanı.
 *
 * Bir batch spool'da en fazla `send_interval_seconds` bekler (§4.3, üst sınır
 * pratikte 30) ve yola çıktıktan sonra bir de ağ süresi eklenir. 60 saniye bu
 * ikisinin toplamına rahat bir pay bırakıyor: altındaysa hiçbir şey kuyrukta
 * BEKLEMİYOR demek.
 */
export const LAG_OK_MS = 60_000;

/**
 * Bunun üstü birikme demek: spool boşalamıyor, yani ya bağlantı kesik kesik ya
 * da gönderim aralığı üretim hızının gerisinde kalmış. Beş dakika, tek bir
 * geçici hatanın backoff'la kapanmasına yetecek kadar uzun.
 */
export const LAG_WARN_MS = 300_000;

/** Kayıt kaç günü kapsıyor — en eski varış ile şimdi arası. */
export function coverageDays(
  oldestReceivedAt: string | null,
  now: number,
): number | null {
  if (!oldestReceivedAt) return null;
  const oldest = Date.parse(oldestReceivedAt);
  if (!Number.isFinite(oldest)) return null;
  return Math.max(0, (now - oldest) / 86_400_000);
}
