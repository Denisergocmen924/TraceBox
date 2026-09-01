/**
 * Overview'ın kart kabuğu — referans 2'deki altı panel de aynı kutuyu paylaşıyor:
 * beyaz zemin, 12px köşe, saçtan ince çerçeve, üstte başlık ve sağ üstte tek bir
 * ikincil eylem ("View all", "All Hosts", "CPU Usage").
 *
 * İçerik `children` olarak GİRİNTİSİZ geliyor: log listesi ve tablo satırları
 * kartın kenarına kadar uzanan ayırıcı çizgiler istiyor, başlık ise 20px içeride.
 * Ortak bir padding verilseydi her iki panelin de onu tek tek iptal etmesi
 * gerekirdi.
 *
 * Başlığın `min-h` değeri (38px = SelectBox'ın yüksekliği) süs değil:
 * `action` bazı panellerde 20px'lik bir bağlantı, bazılarında 38px'lik bir
 * seçici. Sabitlenmeseydi satır eylemin boyuna göre 59px ya da 74px olur,
 * `items-center` de başlığı 8px aşağı iterdi — yan yana duran iki panelin
 * başlığı hizasız çıkardı. Referans 2'de altı panelin başlığı da aynı hatta.
 *
 * Yükseklik SATIRA değil BAŞLIĞA veriliyor: satırın kendi `min-h`'si sınır
 * kutuya uygulanır, 36px'lik dikey padding zaten o eşiği aştığı için hiçbir
 * şey yapmazdı.
 */
import Link from "next/link";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-panel shadow-card ${className}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h2 className="flex min-h-[38px] items-center text-[15px] font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Başlık sağındaki metin bağlantısı — referansta accent renginde, 13px. */
export function PanelLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="shrink-0 text-[13px] font-medium text-accent transition hover:text-accent-strong"
    >
      {children}
    </Link>
  );
}

/** Panelin gövdesinde "veri yok" / "yükleniyor" satırı. */
export function PanelNote({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pb-5 text-sm text-faint">{children}</p>;
}
