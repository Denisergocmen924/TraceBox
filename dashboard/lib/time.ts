/**
 * Ekranda görünen her tarih/saat bu yerel ayarla biçimlenir.
 *
 * `en-GB`, `en-US` değil: 24 saatlik kadran istiyoruz. Referans görselde de
 * eksen "12:00 / 13:00" diye okunuyor, ve bir kara kutu okurken "01:00 PM"
 * gereksiz iki hece. Gün/ay sırası da referansla aynı yönde.
 *
 * Yerel ayar SAAT DİLİMİNİ değiştirmez — tarayıcınınki kullanılır. Yani
 * kullanıcı hâlâ kendi saatini görüyor (§9.5: bloklar UTC, ekran yerel).
 */
const LOCALE = "en-GB";

/**
 * "12 seconds ago" — kartın alt satırındaki insan okunur zaman.
 *
 * `now` dışarıdan verilir, içeride Date.now() çağrılmaz. Sebep iki tane:
 * bileşen saniyede bir tik atıp aynı fonksiyonu yeniden çağırdığında tüm
 * kartlar AYNI ana göre hesaplanır (biri 11, diğeri 12 saniye demez), ve
 * fonksiyon test edilebilir kalır.
 */
export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never seen";

  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/** 16384 → "16.0 GB". Kartta MB yazmak okunaksız. */
export function gb(mb: number | null | undefined): string {
  if (mb == null) return "—";
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Log satırının zaman damgası — YEREL saatle (§9.5).
 *
 * Bloklar UTC'ye göre bölünüyor ama kullanıcı UTC'de yaşamıyor. Blok sınırı
 * içeride bir önbellek detayı; ekranda görünen her saat kullanıcının kendi
 * saatidir. Aynı gün içindeyse yalnızca saat, değilse gün de eklenir —
 * "14:32:07" iki gün önceye aitken tek başına yanıltıcı olurdu.
 */
export function logTime(iso: string, now: number): string {
  const d = new Date(iso);
  const clock = d.toLocaleTimeString(LOCALE, { hour12: false });
  const sameDay = d.toDateString() === new Date(now).toDateString();
  if (sameDay) return clock;
  return `${d.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit" })} ${clock}`;
}

/**
 * Yalnızca saat ve dakika — uyarı satırlarında (referans 2: "13:40").
 *
 * Saniye YOK: bir uyarı, ölçümün kendisi değil ölçümden TÜRETİLMİŞ bir hâl;
 * saniyesini yazmak, olmadığı kadar keskin bir zamanlama iddia ederdi.
 */
export function clockTime(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "2026-08-28T09:00:00Z" → "28/08/2026, 12:00" (yerel). Künyedeki açılış anı. */
export function localDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Grafiğin x ekseni etiketi — YEREL saat, aralığın uzunluğuna göre kısalır.
 *
 * Üç kademe var ve ölçütü hep aynı: BEŞ etiketin birbirinden ayırt edilebilmesi.
 *   · 10 dakikanın altında saniye eklenir. Yakınlaştırma (§9.8) buraya kadar
 *     inebiliyor ve saniyesiz bir eksende beş etiketin üçü "14:32" yazardı —
 *     ham 5 saniyelik örneklere inen kullanıcı (§9.6 madde 2) tam olarak
 *     saniyeyi okumak istiyor.
 *   · Arada saniye YOK: etiketler arası mesafe dakikalarla ölçülüyor, saniye
 *     okunacak bir bilgi değil göze giren gürültü olurdu.
 *   · 36 saatin üstünde gün eklenir — yoksa "03:00" iki farklı güne ait iki
 *     etikette aynı görünürdü.
 */
export function axisTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const clock = d.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (spanMs <= 10 * 60 * 1000) {
    return d.toLocaleTimeString(LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  if (spanMs <= 36 * 3600 * 1000) return clock;
  const day = d.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit" });
  return `${day} ${clock}`;
}

/**
 * Eksen için "yuvarlak" adımlar. Etiketler 12:00 / 12:15 / 12:30 olmalı,
 * pencereyi beşe bölmekten çıkan 12:07 / 12:21 değil: okunur bir eksen,
 * kullanıcının saate bakarken zaten kullandığı sayılara oturur.
 *
 * Beş saniyeden başlıyor çünkü yakınlaştırma (§9.8) ham örneklere kadar
 * inebiliyor ve agent'ın ölçüm aralığı da beş saniye — daha ince bir adımın
 * karşılığı veride yok.
 */
const TICK_STEPS_MS = [
  5_000, 15_000, 30_000,
  60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000,
  3_600_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000,
  86_400_000, 2 * 86_400_000,
];

/**
 * X ekseninin etiket anları. Overview'daki geniş grafik ile cihaz detayının
 * zaman çizelgesi BU fonksiyonu paylaşıyor: iki ayrı uygulama olsaydı aynı
 * pencereye bakan iki grafik farklı anlarda etiketlenir, kullanıcı ikisini
 * gözüyle hizalayamazdı.
 */
export function axisTicks(
  fromMs: number,
  toMs: number,
  /**
   * Etiketlerin gerçekte nereye kadar üretileceği. Varsayılan `toMs`; grafiğin
   * sağındaki boş pay (lib/metrics.ts → RIGHT_GUTTER) için daha ötesi verilir.
   *
   * ADIM yine `toMs`'e göre seçiliyor, buraya göre değil: pay hesaba katılsaydı
   * 1 saatlik bir pencerede aralık 15 dakikadan 30'a çıkar, yani boş payın
   * varlığı VERİNİN üstündeki eksenin sıklığını değiştirirdi.
   */
  untilMs = toMs,
  target = 5,
): number[] {
  const span = Math.max(1, toMs - fromMs);
  const step =
    TICK_STEPS_MS.find((s) => span / s <= target) ??
    TICK_STEPS_MS[TICK_STEPS_MS.length - 1];

  /*
   * Hizalama YEREL duvar saatine göre. Epoch'un katları UTC'ye hizalar; gün
   * adımında bu, UTC+3'te etiketleri 03:00'e oturturdu. Blok sınırları UTC
   * kalıyor (§9.5, retention ile aynı gün tanımı) ama o içeride bir önbellek
   * detayı — EKRANDAKİ her saat kullanıcının kendi saati.
   */
  const offset = new Date(fromMs).getTimezoneOffset() * 60_000;
  const out: number[] = [];
  for (
    let t = Math.ceil((fromMs - offset) / step) * step + offset;
    t <= Math.max(toMs, untilMs);
    t += step
  ) {
    out.push(t);
  }
  return out;
}
