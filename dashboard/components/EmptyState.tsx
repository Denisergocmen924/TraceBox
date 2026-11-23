/**
 * "Gösterecek bir şey yok" kutusu — maskotlu.
 *
 * Hosts sayfasının boş hâlini çizer: maskot görseli, isteğe bağlı başlık
 * ve sayfaya özgü açıklama.
 *
 * `children` sayfaya özgü cümle (bağlantısıyla birlikte); başlık ve açıklama
 * isteğe bağlı, ikisi de yoksa yalnızca cümle gelir.
 */
import Image from "next/image";

/** Dosya adı `public/mascot-<poz>.png`. Yeni poz = bir dosya + bir satır. */
export type Mascot =
  "hosts"; // el sallıyor, fişi uzatıyor: "bir makine bağla"

/** Görsellerin doğal oranı 3:2 ; `h-auto` kalanı çözer. */
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
