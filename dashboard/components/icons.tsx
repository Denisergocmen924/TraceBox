/**
 * Simge seti.
 *
 * Neden hazır bir kütüphane (lucide, heroicons) kurulmadı: tasarım planı
 * ikonları navigasyonda, kartlarda ve log seviyelerinde istiyor — toplamda
 * bir avuç simge. Onlarcası için ~50 KB bağımlılık taşımak "over-engineering
 * yok" ilkesine ters düşerdi. Hepsi 24x24 viewBox, 1.5 kalınlık ve
 * currentColor: renk çağıran taraftan gelir, simge dosyası renk bilmez.
 */
type IconProps = { className?: string };

function Svg({
  className = "size-4",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Sunucu/cihaz — navigasyondaki "Cihazlar" ve kart başlığı. */
export function IconServer(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Svg>
  );
}

export function IconCpu(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </Svg>
  );
}

/** RAM çubuğu. */
export function IconMemory(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="7" width="19" height="10" rx="2" />
      <path d="M7 17v3M12 17v3M17 17v3M7 10.5v3M12 10.5v3M17 10.5v3" />
    </Svg>
  );
}

export function IconDisk(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 13h19" />
      <path d="M6 16.5h.01M9.5 16.5h.01" />
    </Svg>
  );
}

export function IconActivity(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" />
    </Svg>
  );
}

export function IconList(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h11" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 4v7h-7" />
    </Svg>
  );
}

export function IconBell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  );
}

export function IconInfo(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function IconPause(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 5v14M14.5 5v14" />
    </Svg>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 4.5 19 12 7 19.5V4.5Z" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5" />
      <path d="M10.5 10v6M13.5 10v6" />
    </Svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconLogout(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8" />
      <path d="M17 8.5 20.5 12 17 15.5M20.5 12H10" />
    </Svg>
  );
}

export function IconChevron(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}

export function IconMenu(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </Svg>
  );
}

/* --- tema düğmesi (§9.11.1) ----------------------------------------------- */

export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </Svg>
  );
}

/** Ağ giriş/çıkış — özet kartlarındaki dördüncü ölçü. */
export function IconNetwork(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 8 3 12l4 4" />
      <path d="m17 8 4 4-4 4" />
      <path d="M14 5 10 19" />
    </Svg>
  );
}

/** Aşağı ok — açılır listelerin sağındaki işaret. */
export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

/** Bulut — sidebar altındaki toplayıcı rozeti. */
export function IconCloud(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 11.2 3.5 3.5 0 0 0 7 19Z" />
    </Svg>
  );
}

/** Geri ok — yakınlaştırmada bir adım geri (§9.8). */
export function IconArrowLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </Svg>
  );
}

/** Dışa açılan oklar — yakınlaştırmayı sıfırla, tüm aralığa dön (§9.8). */
export function IconExpand(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </Svg>
  );
}

/** Yakınlaştırma büyüteci — sürükleyerek seçim ipucu. */
export function IconZoom(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M8 11h6" />
    </Svg>
  );
}

/* --- kenar çubuğu gezinme simgeleri (referans 2) --------------------------
 * Yedisi de aynı ailede: 24x24, 1.5 kalınlık, currentColor. Referanstaki
 * çizgi kalınlığı ve yuvarlaklık zaten bu ailenin değerleri; simge başına
 * ayrı bir stil yok.
 */

/** Overview — referansın ilk menü öğesi. */
export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <path d="M9.5 20v-5.5h5V20" />
    </Svg>
  );
}

/** Metrics — eksen + çubuklar. */
export function IconChart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4v16h16" />
      <path d="M8.5 16v-4M12.5 16V8M16.5 16v-6" />
    </Svg>
  );
}

/** Logs — satırlı belge. */
export function IconFileText(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </Svg>
  );
}

/** Inventory — bölmeli kutu. */
export function IconInventory(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9.5h3M7 14.5h3M14 9.5h3M14 14.5h3" />
    </Svg>
  );
}

/** Settings — dişli. */
export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </Svg>
  );
}

/* --- cihaz kaydı (§9.10 anahtar penceresi) -------------------------------- */

/** Anahtar — "Add Host" penceresinin başlık simgesi. */
export function IconKey(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.2-8.2M16.5 6.5l2 2M14 9l2 2" />
    </Svg>
  );
}

/** Panoya kopyala. */
export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </Svg>
  );
}

/** Onay — kopyalandı geri bildirimi. */
export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}
