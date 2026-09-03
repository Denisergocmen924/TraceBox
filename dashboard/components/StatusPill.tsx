/**
 * Durum rozeti — dört hâl (§9.3), tek yerde tanımlı.
 *
 * Daha önce durum, kart ile sağ panelde ayrı ayrı çiziliyordu: aynı renk iki
 * dosyada iki kez yazılıydı ve birini değiştirmek diğerini sessizce eskitiyordu.
 * Rozet artık nokta + zemin + kenarlık taşıyor; referans görseldeki gibi düz
 * metin değil, okunur bir etiket.
 */
import {
  STATUS_LABEL,
  type DeviceStatus,
} from "@/lib/devices";

/**
 * Renk anlamı taşır (plan §2): yeşil sağlıklı, kehribar uyarı, kırmızı kritik,
 * gri "haber yok". Çevrimdışı bilerek KIRMIZI DEĞİL: makine bozulmuş olabilir
 * ama kapatılmış da olabilir; kırmızı, olmayan bir kesinlik iddia ederdi.
 */
const TONE: Record<DeviceStatus, { dot: string; chip: string }> = {
  online: { dot: "bg-ok", chip: "bg-ok/10 text-ok border-ok/25" },
  offline: { dot: "bg-muted", chip: "bg-muted/10 text-muted border-line" },
  paused: { dot: "bg-warn", chip: "bg-warn/10 text-warn border-warn/25" },
  deleting: {
    dot: "bg-danger",
    chip: "bg-danger/10 text-danger border-danger/25",
  },
};

export function StatusDot({ status }: { status: DeviceStatus }) {
  return (
    <span className={`size-2 shrink-0 rounded-full ${TONE[status].dot}`} />
  );
}

export function StatusPill({ status }: { status: DeviceStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE[status].chip}`}
    >
      <span className={`size-1.5 rounded-full ${TONE[status].dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
