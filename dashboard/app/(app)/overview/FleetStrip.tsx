/**
 * Filo şeridi — veri yolu panelinin alt bandı.
 *
 * Kendi paneli DEĞİL, bilerek. "Kaydırmasız tek ekran" hedefi için her panel
 * başlığı 74 piksel; filo, yolun sol ucunda duran Agent durağının somut hâli
 * olduğu için aynı kutunun içinde yaşıyor. Ayrı bir panel olsaydı, aynı şeyi
 * iki kez başlıklandırıp ekranı taşırmış olurduk.
 *
 * Hosts sayfasının kopyası da değil: orada kart başına CPU/RAM/Disk çubukları,
 * künye ve eylemler var. Burada makine başına yalnızca üç şey duruyor — adı,
 * hâli ve en son ne zaman konuştuğu.
 *
 * Yatay kaydırma bilerek: filo büyüdükçe şerit SATIRA yayılmıyor, kayıyor.
 * Sarmalasaydı üç makinede 56 piksel, on beşte 180 piksel yer kaplar ve ekran
 * yüksekliği cihaz sayısına bağlı hâle gelirdi.
 */
import Link from "next/link";
import { StatusDot } from "@/components/StatusPill";
import { deviceStatus, STATUS_LABEL, type Device } from "@/lib/devices";
import { relativeTime } from "@/lib/time";

export function FleetStrip({
  devices,
  now,
}: {
  devices: Device[];
  now: number;
}) {
  if (devices.length === 0) {
    return (
      <p className="text-xs text-faint">
        No hosts yet — add one from the Hosts page to start recording.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <ul className="flex min-w-max gap-2.5">
        {devices.map((device) => {
          const status = deviceStatus(device, now);
          return (
            <li key={device.id}>
              <Link
                href={`/devices/${device.id}`}
                className="flex w-52 items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2 transition hover:border-accent/40"
              >
                <StatusDot status={status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {device.device_name}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {STATUS_LABEL[status]} · {relativeTime(device.last_seen, now)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
