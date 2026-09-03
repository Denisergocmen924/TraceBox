/**
 * Sayfa başlığı — Overview'ın başlığından çıkarıldı, altı sayfa paylaşıyor.
 *
 * Ortak bir bileşen olmasının sebebi hizalama: 28px başlık, altında 14px açıklama
 * ve sağda isteğe bağlı bir sayaç şeridi. Her sayfa kendi başlığını yazsaydı
 * boşluklar birkaç piksel kayar ve kabuk sayfadan sayfaya zıplardı.
 *
 * `scope` satırı yalnızca üst çubuktaki host seçicisi bir makineye kısıldığında
 * doluyor. Yazılması ZORUNLU: seçici sayfanın en üstünde küçük bir kutu ve
 * kullanıcı, listenin dar olmasının sebebinin o kutu olduğunu unutabilir —
 * boş bir sayfaya bakıp veri kaybettiğini sanardı. §9.6 madde 5'in dürüstlük
 * kuralının navigasyondaki karşılığı.
 */
export function PageHeader({
  title,
  description,
  scope,
  children,
}: {
  title: string;
  description: string;
  /** Daraltılmış kapsamın adı; `null` ise satır çizilmiyor. */
  scope?: string | null;
  /** Sağ uçtaki sayaç şeridi ya da eylem düğmesi. */
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {description}
          {scope && (
            <>
              {" · "}
              <span className="font-medium text-fg">
                filtered to {scope}
              </span>
            </>
          )}
        </p>
      </div>
      {children}
    </header>
  );
}

/** Başlığın sağındaki sayaç — Overview'daki "5 Hosts · 4 Online · 1 Offline". */
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
