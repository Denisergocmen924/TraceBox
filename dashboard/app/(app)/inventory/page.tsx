/**
 * Inventory — kenar çubuğundaki "Inventory" bölümünün sayfası.
 *
 * Metrics "şu anda ne oluyor"u, Inventory "bu makine NE"yi cevaplıyor. İkisi
 * ayrı sayfa çünkü ayrı hızlarda değişiyorlar: metrik 5 saniyede bir, künye
 * ayda bir (agent yalnızca DEĞİŞTİĞİNDE `POST /inventory` atıyor, §7).
 *
 * Künye şimdiye kadar yalnızca cihaz detayının sağ panelinde, tek makine için
 * vardı. Cevaplanamayan soru şuydu: "hangi makinelerim hâlâ 22.04'te",
 * "hangisinde GPU var", "hepsinde agent'ın son sürümü mü". Bunlar tek tek
 * kartlara girip karşılaştırmayı gerektiriyordu; tablo tam olarak bunun için.
 *
 * Kendi sorgusunu açıyor (`fetchInventory`) — kabuğun 10 saniyede bir çektiği
 * liste bu alanları taşımıyor ve taşımamalı da (lib/devices.ts → LIST_COLUMNS).
 * Bu yüzden sayfa kabukla aynı anda değil, `reloadNonce` değiştiğinde ve ilk
 * açılışta tazeleniyor: ayda bir değişen bir alan için 10 saniyelik anket
 * israf olurdu.
 *
 * BİÇİM: makine başına bir KART, 13 sütunlu bir tablo değil (2026-08-31).
 *
 * İlk hâli geniş bir tabloydu ve kullanıcının itirazı yerindeydi: on üç sütun
 * hiçbir ekrana sığmıyor, yatay kaydırma gerektiriyordu. Yatay kaydırma bir
 * künye listesinde özellikle kötü — kullanıcı "bu makine ne" diye bakarken
 * makinenin yarısını görüp diğer yarısı için sağa kayıyor, adı da ekrandan
 * çıkıyordu.
 *
 * Kart, aynı bilgiyi DİKDÖRTGENE katlıyor: her alan sabit bir yerde duruyor,
 * her kart aynı ızgarayı kullanıyor. Karşılaştırma sütun takip ederek değil,
 * kartlar arasında AYNI HÜCREYE bakarak yapılıyor — "hangisinde GPU var"
 * sorusu göz aşağı kayarken hep aynı noktadan okunuyor.
 *
 * Kartlar tek sütunda ve tam genişlikte: iki sütuna dizilseydi ızgara daralır,
 * uzun CPU modeli yine kırpılır ve tek makineli hesapta kart ekranın yarısında
 * asılı kalırdı.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import {
  deviceStatus,
  fetchInventory,
  type InventoryDevice,
} from "@/lib/devices";
import { gb, localDateTime, relativeTime } from "@/lib/time";
import { errorMessage } from "@/lib/errors";
import { PageHeader, Tally } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { IconChevron } from "@/components/icons";

/** Boş bir alanın yerine tire — hücre boş kalırsa kart çökmüş gibi görünüyor. */
function Cell({ value }: { value: string | number | null | undefined }) {
  if (value == null || value === "") {
    return <span className="text-faint">—</span>;
  }
  return <>{value}</>;
}

/**
 * Kartın içindeki tek künye alanı: üstte küçük büyük-harf etiket, altında değer.
 *
 * Etiket her zaman görünür — tablodaki gibi tek bir başlık satırına
 * yaslanmıyor. Sebep kartın kendisi: on üç sütunluk bir tabloda başlık satırı
 * bir kez yazılır, kartta ise her kutu kendi başına anlaşılmalı, yoksa
 * "6.8.0-51-generic" yazan bir hücrenin ne olduğu ancak tahmin edilebilirdi.
 */
function Field({
  label,
  value,
  hint,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[11px] font-semibold tracking-wider text-faint uppercase">
        {label}
      </p>
      <p className="mt-1 truncate text-sm">{value}</p>
      {hint != null && (
        <p className="mt-0.5 truncate text-xs text-faint">{hint}</p>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const { error: shellError, now, hostFilter, reloadNonce } = useApp();

  const [rows, setRows] = useState<InventoryDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetchInventory()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load, reloadNonce]);

  const scoped = useMemo<InventoryDevice[]>(() => {
    if (!rows) return [];
    return hostFilter ? rows.filter((d) => d.id === hostFilter) : rows;
  }, [rows, hostFilter]);

  const scopeName =
    hostFilter && rows
      ? (rows.find((d) => d.id === hostFilter)?.device_name ?? null)
      : null;

  /*
   * "Reporting" = envanterini bir kez göndermiş makine sayısı. Yeni kurulan bir
   * agent ilk turunu tamamlayana kadar satırda yalnızca ad ve anahtar var;
   * sayaç bunu saklamak yerine söylüyor, kullanıcı boş hücreleri hata sanmasın.
   */
  const reporting = scoped.filter((d) => d.cpu_model != null).length;

  return (
    <div className="mx-auto max-w-[1248px]">
      <PageHeader
        title="Inventory"
        description="What each host is, as the agent last reported it."
        scope={scopeName}
      >
        {rows && (
          <div className="flex divide-x divide-line">
            <Tally value={scoped.length} label="Hosts" />
            <Tally value={reporting} label="Reporting" tone="text-ok" />
          </div>
        )}
      </PageHeader>

      {(error ?? shellError) && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read inventory: {error ?? shellError}
        </p>
      )}

      {rows === null && !error && (
        <div className="h-64 animate-pulse rounded-card border border-line bg-panel shadow-card" />
      )}

      {rows && scoped.length === 0 && (
        <p className="rounded-card border border-line bg-panel p-12 text-center text-sm text-muted shadow-card">
          {rows.length === 0 ? (
            <>
              No hosts yet. Add one from{" "}
              <Link href="/devices" className="font-medium text-accent">
                Hosts
              </Link>
              .
            </>
          ) : (
            "The selected host is not in this account any more."
          )}
        </p>
      )}

      {rows && scoped.length > 0 && (
        <div className="space-y-4">
          {scoped.map((device) => (
            <section
              key={device.id}
              className="rounded-card border border-line bg-panel shadow-card"
            >
              {/* --- künye başlığı ------------------------------------- */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
                <Link
                  href={`/devices/${device.id}`}
                  className="text-[15px] font-semibold transition hover:text-accent"
                >
                  {device.device_name}
                </Link>
                <StatusPill status={deviceStatus(device, now)} />

                {/* İşletim sistemi başlıkta, ızgarada değil: "bu makine ne"
                    sorusunun ilk yarısı bu ve her kartın en üstünde aynı
                    yerde durması, kartlar arasında göz kaydırmayı ucuzlatıyor. */}
                <span className="text-sm text-muted">
                  <Cell
                    value={
                      device.os_name
                        ? `${device.os_name} ${device.os_version ?? ""}`.trim()
                        : null
                    }
                  />
                  {device.arch && ` · ${device.arch}`}
                </span>

                <Link
                  href={`/devices/${device.id}`}
                  className="ml-auto inline-flex text-faint transition hover:text-accent"
                  aria-label={`Open ${device.device_name}`}
                >
                  <IconChevron className="size-4" />
                </Link>
              </div>

              {/*
                Izgara DÖRT sütun ve her kartta aynı: donanım üstte, sistem
                altta. Alanların yeri sabit olmasaydı kart, tablonun çözdüğü
                tek şeyi — aynı bilgiyi aynı yerde bulma — kaybederdi.
              */}
              <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label="CPU"
                  className="lg:col-span-2"
                  /* Model uzun ("Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz") ve
                     tek başına çekirdek sayısını söylemiyor; ikisi alt alta. */
                  value={
                    <span title={device.cpu_model ?? undefined}>
                      <Cell value={device.cpu_model} />
                    </span>
                  }
                  hint={
                    device.cpu_cores_logical == null ? (
                      "—"
                    ) : (
                      <>
                        {device.cpu_cores_logical} logical
                        {device.cpu_cores_physical != null &&
                          ` · ${device.cpu_cores_physical} physical`}
                      </>
                    )
                  }
                />

                <Field
                  label="Memory"
                  value={
                    <span className="tabular-nums">
                      <Cell value={gb(device.ram_total_mb)} />
                    </span>
                  }
                />

                <Field
                  label="Disk"
                  value={
                    <span className="tabular-nums">
                      <Cell value={gb(device.disk_total_mb)} />
                    </span>
                  }
                />

                <Field
                  label="Kernel"
                  value={
                    <span title={device.kernel_version ?? undefined}>
                      <Cell value={device.kernel_version} />
                    </span>
                  }
                />

                <Field
                  label="GPU"
                  value={
                    <span title={device.gpu_model ?? undefined}>
                      <Cell value={device.gpu_model} />
                    </span>
                  }
                />

                <Field
                  label="External IP"
                  value={
                    <span className="tabular-nums">
                      <Cell value={device.external_ip} />
                    </span>
                  }
                />

                <Field
                  label="Agent"
                  value={
                    <span className="tabular-nums">
                      <Cell value={device.agent_version} />
                    </span>
                  }
                />

                {/* Açılış anı iki biçimde: üstte "ne kadar süredir ayakta"
                    (asıl merak edilen), altında tam tarih. */}
                <Field
                  label="Booted"
                  value={
                    <Cell
                      value={
                        device.last_boot
                          ? relativeTime(device.last_boot, now)
                          : null
                      }
                    />
                  }
                  hint={
                    device.last_boot ? localDateTime(device.last_boot) : undefined
                  }
                />

                {/* Eklentiler config'te açılıyor (§4.3). Boş olması hata değil,
                    varsayılan — o yüzden "none" yazıyor, tire değil: tire
                    "bilinmiyor" demek. Rozetler sarmalanabildiği için alan
                    son satırın kalan üç sütununu birden kaplıyor: CPU zaten iki
                    sütun geniş olduğu için 4+4+4 = tam üç satır çıkıyor ve
                    kartın altında yarım kalmış bir sıra kalmıyor. */}
                <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                  <p className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                    Add-ons
                  </p>
                  {device.enabled_addons.length === 0 ? (
                    <p className="mt-1 text-sm text-faint">none</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {device.enabled_addons.map((addon) => (
                        <span
                          key={addon}
                          className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
                        >
                          {addon}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {rows && scoped.length > 0 && reporting < scoped.length && (
        <p className="mt-4 text-xs text-muted">
          {scoped.length - reporting} of these hosts have not reported an
          inventory yet — their agent uploads it once on start-up and only again
          when the hardware actually changes, so empty cells here mean
          &ldquo;not yet received&rdquo;, not &ldquo;missing&rdquo;.
        </p>
      )}
    </div>
  );
}
