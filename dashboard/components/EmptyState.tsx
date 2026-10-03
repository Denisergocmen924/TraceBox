/**
 * "Gösterecek bir şey yok" kutusu — maskotlu.
 *
 * Hosts, Metrics, Logs, Inventory ve Alerts sayfalarının boş hâli beş yerde
 * aynı çıplak `<p>` idi: boş, standart, ürünün kimliğinden hiçbir şey
 * taşımıyor. Tek bileşen hem görünümü hem tonu ortaklaştırır; beş kopya
 * olsaydı biri er ya da geç farklı çıkardı.
 *
 * Poz sayfanın konusunu taşır (`mascot`): Logs büyüteçle okur, Metrics grafik
 * gösterir... Ton da pozla eşleşmeli: "her şey yolunda" mesajına şaşkın yüz
 * yanlış ton verirdi, o yüzden Alerts'in "Nothing to report" kutusu `ok`
 * pozunu (başparmak) kullanır.
 *
 * `children` sayfaya özgü cümle (bağlantısıyla birlikte); başlık ve açıklama
 * isteğe bağlı, ikisi de yoksa yalnızca cümle gelir.
 */
import Image from "next/image";

/** Dosya adı `public/mascot-<poz>.png`. Yeni poz = bir dosya + bir satır. */
export type Mascot =
  | "hosts" // el sallıyor, fişi uzatıyor: "bir makine bağla"
  | "metrics" // holografik grafiği gösteriyor
  | "logs" // büyüteçle log kağıdını okuyor
  | "inventory" // checklist
  | "alert" // şaşkın, ünlem işaretleri
  | "ok" // başparmak: her şey yolunda
  | "shrug" // omuz silkiyor: aranan şey yok
  | "lost"; // baş kaşıyor, soru işaretleri (404)

/** Görsellerin doğal oranı 3:2 (alert hariç); `h-auto` kalanı çözer. */
export function EmptyState({
  mascot,
  title,
  children,
  dashed = false,
}: {
  mascot: Mascot;
  title?: string;
  children: React.ReactNode;
  /** Hosts sayfasının kesik çizgili çerçevesi: "buraya bir şey eklenecek" der. */
  dashed?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-card border bg-panel px-6 py-10 text-center shadow-card ${
        dashed ? "border-dashed border-line bg-panel/60" : "border-line"
      }`}
    >
      <Image
        src={`/mascot-${mascot}.png`}
        alt=""
        width={768}
        height={512}
        className="h-auto w-52 select-none"
        draggable={false}
      />
      {title && <p className="mt-4 font-medium">{title}</p>}
      <div className="mt-2 max-w-md text-sm text-muted">{children}</div>
    </div>
  );
}
