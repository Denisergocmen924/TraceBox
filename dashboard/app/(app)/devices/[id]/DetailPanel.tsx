/**
 * Cihaz detayının SAĞ paneli (CLAUDE.md §9.4).
 *
 * Dar panelin işi tek: "hangi makineye bakıyorum, ne durumda, ne yapabilirim".
 * Sayfa kaydırılırken yerinde kalır (sticky) — log listesinin dibine inen
 * kullanıcı hangi cihazın loglarını okuduğunu unutmasın diye.
 *
 * Oran 70/30, referans görselin 55/45'inden bilinçli sapma: oradaki sağ panel
 * bir form, bizimki iki buton ve künye. Buna karşılık log satırları uzun ve
 * dar alanda kırpılıyor — geniş olması gereken taraf sol.
 *
 * Künye üç bloğa ayrıldı: DONANIM (değişmez), SİSTEM (yeniden kurulumla
 * değişir), AGENT (sürekli değişir). Tek uzun liste olduğunda göz "RAM
 * nerede" diye baştan taramak zorunda kalıyordu.
 *
 * Aksiyonlar (duraklat/devam/sil) burada, listede DEĞİL (§9.3): silme geri
 * alınamaz bir iş ve kartların üstünde, yanlışlıkla tıklanacak bir yerde
 * durmamalı.
 *
 * İkisi arasındaki fark §9.10'dan geliyor: duraklatma GERİ ALINABİLİR ve
 * §9.10'un saydığı yıkıcı işlemler arasında yok, o yüzden onay penceresi
 * istemiyor — her duraklatmada pencere açmak, pencerenin kendisini anlamsız
 * bir refleks tuşuna çevirirdi. Silme tam pencereden geçiyor.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/appState";
import { queueCommand, type CommandType } from "@/lib/commands";
import {
  deviceStatus,
  forceRemoveDevice,
  isSilent,
  type DeviceDetail,
} from "@/lib/devices";
import { gb, localDateTime, relativeTime } from "@/lib/time";
import { errorMessage } from "@/lib/errors";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusPill } from "@/components/StatusPill";
import {
  IconPause,
  IconPlay,
  IconServer,
  IconTrash,
} from "@/components/icons";

/**
 * Hangi onay penceresi açık. Üç hâl tek değişkende çünkü İKİSİ AYNI ANDA
 * AÇILAMAZ — iki ayrı boolean tutmak, ikisinin birden true olduğu imkânsız bir
 * durumu temsil edilebilir kılardı.
 */
type Dialog = "none" | "delete" | "force";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums" title={value}>
        {value}
      </span>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-faint">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function DetailPanel({
  device,
  now,
  onChanged,
}: {
  device: DeviceDetail;
  now: number;
  /** Komut yazıldıktan sonra künyeyi hemen tazeler — 10 saniyelik turu
      beklemek, kullanıcıya butonun işe yaramadığını düşündürürdü. */
  onChanged: () => void;
}) {
  const { accountId, reload } = useApp();
  const router = useRouter();
  const status = deviceStatus(device, now);
  // Durumdan AYRI: silme kuyruğa girince status "deleting" olur ama makine
  // sessiz kalmaya devam eder. Aşağıdaki iki karar sessizliğe bakmalı,
  // etikete değil (bkz. lib/devices.ts → isSilent).
  const silent = isSilent(device, now);

  const [dialog, setDialog] = useState<Dialog>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bekleyen komut türleri kuyruktan okunuyor (§6: ara durumun ayrı bir bayrağı
  // yok). Aynı emri ikinci kez sıraya koymayı engelleyen tek şey bu.
  const pending = new Set<CommandType>(device.pendingCommands);
  const togglePending = pending.has("pause") || pending.has("resume");
  const deletePending = pending.has("delete");

  async function send(type: CommandType) {
    setBusy(true);
    setError(null);
    try {
      await queueCommand({ deviceId: device.id, accountId, type });
      setDialog("none");
      onChanged();
      reload(); // sidebar ve cihaz listesi de aynı anda tazelensin
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Zorla kaldırma — komut kuyruğunu atlayıp satırı doğrudan siler (§6).
   *
   * Sonrasında listeye dönmek ZORUNLU: bu sayfanın konu aldığı satır artık
   * yok, yerinde kalmak kullanıcıyı bir "bulunamadı" ekranına bakar durumda
   * bırakırdı. `replace` kullanılıyor ki geri düğmesi silinmiş cihazın
   * detayına dönmesin.
   */
  async function forceRemove() {
    setBusy(true);
    setError(null);
    try {
      await forceRemoveDevice(device.id);
      reload();
      router.replace("/devices");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <aside className="space-y-5 lg:sticky lg:top-22">
      <section className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
        <div className="flex items-start gap-3 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <IconServer className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate font-semibold"
              title={device.device_name}
            >
              {device.device_name}
            </h1>
            <div className="mt-2">
              <StatusPill status={status} />
            </div>
          </div>
        </div>

        <Group title="HARDWARE">
          <Row label="CPU" value={device.cpu_model ?? "—"} />
          <Row
            label="Cores"
            value={
              device.cpu_cores_logical
                ? `${device.cpu_cores_logical} logical` +
                  (device.cpu_cores_physical
                    ? ` · ${device.cpu_cores_physical} physical`
                    : "")
                : "—"
            }
          />
          <Row label="Architecture" value={device.arch ?? "—"} />
          <Row label="RAM" value={gb(device.ram_total_mb)} />
          <Row label="Disk" value={gb(device.disk_total_mb)} />
          {device.gpu_model && <Row label="GPU" value={device.gpu_model} />}
        </Group>

        <Group title="SYSTEM">
          <Row
            label="Operating system"
            value={
              [device.os_name, device.os_version].filter(Boolean).join(" ") ||
              "—"
            }
          />
          <Row label="Kernel" value={device.kernel_version ?? "—"} />
          <Row label="Booted" value={localDateTime(device.last_boot)} />
          {device.external_ip && (
            <Row label="External IP" value={device.external_ip} />
          )}
        </Group>

        <Group title="AGENT">
          <Row label="Version" value={device.agent_version ?? "—"} />
          <Row label="Last seen" value={relativeTime(device.last_seen, now)} />
          <Row
            label="Shipping"
            value={device.logging_enabled ? "on" : "paused"}
          />
          {device.enabled_addons.length > 0 && (
            <Row label="Add-ons" value={device.enabled_addons.join(", ")} />
          )}
        </Group>
      </section>

      <section className="space-y-2 rounded-card border border-line bg-panel p-4 shadow-card">
        <button
          onClick={() => send(device.logging_enabled ? "pause" : "resume")}
          disabled={busy || togglePending || deletePending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm font-medium transition hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {device.logging_enabled ? (
            <IconPause className="size-4" />
          ) : (
            <IconPlay className="size-4" />
          )}
          {togglePending
            ? "Queued…"
            : device.logging_enabled
              ? "Pause"
              : "Resume"}
        </button>

        {/*
          "Delete" vurgusuz (§9.10: tehlikeli buton dolu zemin almaz) ve pencere
          açmaktan başka bir şey yapmıyor — asıl işlem onaydan sonra.
        */}
        <button
          onClick={() => {
            setError(null);
            setDialog("delete");
          }}
          disabled={busy || deletePending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-danger/40 px-3 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconTrash className="size-4" />
          {deletePending ? "Delete queued" : "Delete"}
        </button>

        {/*
          Komut anında uygulanmıyor: agent ~10 saniyede bir soruyor (§7).
          Bunu yazmak zorunlu — yazmasak buton basılmış ama hiçbir şey olmamış
          gibi görünürdü. Cihaz sessizse dahası da var: emir, makine geri
          dönene kadar sırada bekler.
        */}
        {(togglePending || deletePending) && (
          <p className="pt-1 text-xs text-faint">
            {silent
              ? "This host is offline. The command stays queued until the agent reconnects."
              : "The agent applies it on its next command poll (~10s)."}
          </p>
        )}

        {/*
          ZORLA KALDIRMA — yalnızca makine SESSİZKEN görünüyor (§9.13'te
          açık kalan "nerede duracak" sorusunun cevabı).

          Çevrimiçi bir cihazda gösterilmiyor, çünkü orada zararlı: satır
          silinir, ama makinedeki agent kurulu kalır ve artık hiçbir satırla
          eşleşmeyen anahtarıyla sonsuza kadar 401 alır. Ulaşılabilir bir
          makinede doğru yol her zaman normal silme — agent kendini temizler.
          Buton ancak o yol İŞLEMEZ hâle geldiğinde, yani makine sessizken
          ortaya çıkıyor.

          Ölçüt `status === "offline"` DEĞİL, `silent`: delete kuyruğa girince
          status "deleting" oluyordu ve buton tam ihtiyaç anında kayboluyordu.
          Hiç eşlenmemiş bir cihaza (last_seen null) silme emri verildiğinde
          kaçış kapısı kalmıyordu — emri uygulayacak agent hiç var olmadığı
          için kuyruk sonsuza kadar bekliyordu.
        */}
        {silent && (
          <button
            onClick={() => {
              setError(null);
              setDialog("force");
            }}
            disabled={busy}
            className="w-full rounded-lg px-3 py-2 text-xs font-medium text-muted transition hover:bg-panel-2 hover:text-danger disabled:opacity-40"
          >
            Force remove from account
          </button>
        )}

        {error && dialog === "none" && (
          <p className="pt-1 text-xs text-danger" role="alert">
            Could not send the command: {error}
          </p>
        )}
      </section>

      {dialog === "delete" && (
        <ConfirmDialog
          title="Delete host"
          requireText={device.device_name}
          busy={busy}
          error={error}
          onConfirm={() => send("delete")}
          onCancel={() => setDialog("none")}
        >
          {/*
            Ne olacağı tek tek yazılıyor. "Emin misiniz?" diye sormak, sorunun
            neyi kapsadığını kullanıcının tahminine bırakmak olurdu: silinen
            yalnızca satır değil, cihazın 10 günlük tüm geçmişi (CASCADE, §5) —
            ve agent kendi kendini makineden kaldırıyor (§7).
          */}
          <p>
            All metrics, logs and crash snapshots for{" "}
            <span className="text-fg">{device.device_name}</span> will be
            deleted.
          </p>
          <p>
            On its next command poll the agent uninstalls itself: the service is
            stopped, and the config and device key are wiped.
          </p>
          {status === "offline" && (
            <p className="text-warn">
              This host is offline. The command will wait in the queue — if the
              machine never reconnects, the record stays here.
            </p>
          )}
        </ConfirmDialog>
      )}

      {dialog === "force" && (
        <ConfirmDialog
          title="Force remove host"
          confirmLabel="Force remove"
          requireText={device.device_name}
          busy={busy}
          error={error}
          onConfirm={forceRemove}
          onCancel={() => setDialog("none")}
        >
          <p>
            This deletes <span className="text-fg">{device.device_name}</span>{" "}
            and all of its data immediately, without waiting for the agent.
          </p>
          {/*
            Kullanıcının bilmeden bırakabileceği kalıntı burada tek tek
            yazılıyor. Bunu söylememek, "silindi" diyip makinede çalışmaya
            devam eden bir servis bırakmak olurdu.
          */}
          <p>
            The agent is <span className="text-fg">not</span> uninstalled. If
            that machine ever comes back it will keep running with a key that no
            longer matches anything, so run{" "}
            <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-xs">
              uninstall.sh
            </code>{" "}
            on it if you can.
          </p>
          <p>
            Use this only when the machine is gone for good. For a host you can
            still reach, Delete is the right button — the agent cleans itself
            up.
          </p>
        </ConfirmDialog>
      )}

    </aside>
  );
}
