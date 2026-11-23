/**
 * Sayfa başlığı — sayfalar ortak başlık düzenini paylaşıyor.
 *
 * Ortak bir bileşen olmasının sebebi hizalama: 28px başlık, altında 14px açıklama
 * ve sağda isteğe bağlı bir sayaç şeridi. Her sayfa kendi başlığını yazsaydı
 * boşluklar birkaç piksel kayar ve kabuk sayfadan sayfaya zıplardı.
 */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  /** Sağ uçtaki sayaç şeridi ya da eylem düğmesi. */
  children?: React.ReactNode;
}) {
  return (
    <header className="rise mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {description}
        </p>
      </div>
      {children}
    </header>
  );
}

/** Başlığın sağındaki sayaç — örn. "5 Hosts · 4 Online · 1 Offline". */
export function Tally({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="px-5 text-center">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className={`mt-0.5 text-xs ${tone ?? "text-muted"}`}>{label}</p>
    </div>
  );
}
