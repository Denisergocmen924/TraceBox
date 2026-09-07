/**
 * Kilit düğmesi + "Live" rozeti — canlı akışın (§9.9) TEK görünen yüzü.
 *
 * İkisi tek bileşende, çünkü aynı şeyin iki yarısı: rozet akışın gerçekten
 * ilerleyip ilerlemediğini söylüyor (§9.6 madde 5), düğme kullanıcının onu
 * durdurup durdurmadığını. Ayrı ayrı yerleştirilselerdi bir panelde rozet,
 * ötekinde düğme kalabilir ve kullanıcı "Live" yazan ama ilerlemeyen bir
 * ekranın sebebini hiçbir yerde göremezdi.
 *
 * Kilit PAYLAŞILAN bir bayrak (lib/appState.tsx): buradaki düğme yalnızca
 * yanındaki paneli değil, sayfadaki grafiği ve log listesini birlikte
 * donduruyor — §9.8 "zaman aralığı TEKTİR" kuralının gereği. Bu yüzden hangi
 * kopyasına basıldığının bir önemi yok, hepsi aynı anahtarı çeviriyor.
 *
 * Üst çubukta DEĞİL, panelin başlığında: kilit soyut bir tercih değil, tam da
 * o an bakılan grafiğin ilerleyip ilerlemediği. Kararın verildiği yer ile
 * sonucunun görüldüğü yer arasında göz gezdirmek gerekmemeli.
 */
"use client";

import { useApp } from "@/lib/appState";
import { canStream } from "@/lib/devices";
import { IconLock, IconLockOpen } from "./icons";

export function LiveLock({
  connected,
  /**
   * Rozetin KAPSAMI: yanındaki panel hangi makineye bakıyor. `null` = hesabın
   * tümü (Logs sayfası, süzgeç kapalıyken).
   *
   * Kanalın kendi kapsamıyla aynı olmak ZORUNDA değil ve metriklerde zaten
   * değil: `subscribeMetrics` bilerek hesap geneli dinliyor (lib/realtime.ts),
   * çünkü pencerenin sağ kenarı duvar saatini gösteriyor. Rozet ise kenarın
   * değil, GRAFİĞİN doğruluğunu bildiriyor — o yüzden kapsamı panelin kendisi
   * veriyor.
   */
  deviceId,
}: {
  connected: boolean;
  deviceId: string | null;
}) {
  const { locked, toggleLock, devices, now } = useApp();

  /*
   * Rozetin KAYNAK yarısı — bu bileşendeki tek gerçek mantık.
   *
   * `connected` yalnızca WebSocket'in kurulduğunu söylüyor (lib/realtime.ts:
   * status === "SUBSCRIBED"). Bu, hiç eşleşmemiş bir makinede DE doğru: soket
   * kurulur, yeşil nokta atar, ekranda tek satır yoktur. Daha kötüsü, cihaz
   * detayında sağ paneldeki durum rozeti "Offline" derken soldaki bu rozet
   * "Live" diye yanıp söner — ekran kendi kendisiyle çelişirdi.
   *
   * O yüzden rozet iki koşulun kesişimi: kanal açık VE bu panelin baktığı
   * makine gerçekten gönderebiliyor. Cevap `devices` + `now` ile geliyor,
   * ikisi de zaten context'te — ek sorgu yok.
   */
  const scoped = deviceId ? devices?.find((d) => d.id === deviceId) : null;
  const streaming = deviceId
    ? scoped != null && canStream(scoped, now)
    : (devices?.some((d) => canStream(d, now)) ?? false);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={toggleLock}
        aria-pressed={locked}
        aria-label={locked ? "Unlock and follow live data" : "Lock the current view"}
        title={
          locked
            ? "Locked: the view is frozen. Click to follow live data again."
            : "Live: the view follows new data. Click to freeze it."
        }
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
          locked
            ? "border-accent/50 bg-accent-soft text-accent"
            : "border-line bg-panel text-muted hover:text-fg"
        }`}
      >
        {locked ? (
          <IconLock className="size-3.5 shrink-0" />
        ) : (
          <IconLockOpen className="size-3.5 shrink-0" />
        )}
        {locked ? "Locked" : "Lock"}
      </button>

      {/*
        Üç hâl, ve üçünün de arkasında bir KANIT var:

          kanal kapalı ........... hiçbir şey — söylenecek bir şey bilinmiyor
          kanal açık, kaynak yok . sönük "Idle", nabız YOK
          kanal açık + kaynak var  yeşil nabızlı "Live"

        `devices` henüz yüklenmemişken (null) de sessiz kalıyoruz: "Idle"
        basmak, bilmediğimiz bir şeyi iddia etmek olurdu ve liste inince
        rozet gözün önünde yer değiştirirdi.

        "Idle" ile hiç rozet olmaması ayrı ayrı duruyor, çünkü kullanıcının
        iki farklı sorunu var: bağlantı mı koptu, makine mi sustu. Tek bir
        boşlukla ikisi aynı görünürdü.
      */}
      {connected && devices != null && (
        <span
          title={
            streaming
              ? "Connected to the live stream and this view has a host sending data."
              : deviceId
                ? "Connected to the live stream, but this host is not sending — it is offline or paused."
                : "Connected to the live stream, but no host in this account is sending right now."
          }
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
            streaming ? "bg-ok-soft text-ok" : "bg-panel-2 text-faint"
          }`}
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              streaming ? "animate-pulse bg-ok" : "bg-faint"
            }`}
          />
          {streaming ? "Live" : "Idle"}
        </span>
      )}
    </div>
  );
}
