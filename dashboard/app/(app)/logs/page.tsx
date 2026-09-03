/**
 * Logs — kenar çubuğundaki "Logs" bölümünün sayfası.
 *
 * Neden ayrı bir sayfa: log listesi daha önce YALNIZCA cihaz detayında
 * yaşıyordu. "Bu makinede ne oldu" sorusunun cevabı oradaydı ama "hesabımda
 * bir yerlerde bir hata var mı" sorusunun cevabı hiçbir yerde yoktu —
 * kullanıcı makineleri tek tek gezmek zorundaydı. Overview'ın beş satırlık
 * kartı da yalnızca en yenileri gösteriyor, süzgeci ve sayfalaması yok.
 *
 * Liste bileşeni cihaz detayıyla AYNI (components/LogList): blok blok çekme
 * (§9.5), ekrandan uzaklaşan blokları atma, seviye süzgeci ve saniyede bir
 * boşalan canlı akış (§9.9) burada da aynen çalışıyor. Tek fark bir sütun —
 * `deviceNames` verildiği için her satır hangi makineden geldiğini yazıyor ve
 * o ad cihazın kendi sayfasına bağlanıyor.
 *
 * `deviceId = null` iken sorgu cihaz filtresi yazmıyor; kapsamı RLS
 * (`account_id = auth.uid()`) tutuyor. Üst çubuktan bir makine seçilirse
 * filtre geri geliyor — yani seçici burada da tüm sayfayı daraltıyor.
 */
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useApp } from "@/lib/appState";
import { PageHeader } from "@/components/PageHeader";
import { LogList } from "@/components/LogList";

export default function LogsPage() {
  const { devices, error, hostFilter } = useApp();

  const deviceNames = useMemo(
    () => new Map((devices ?? []).map((d) => [d.id, d.device_name])),
    [devices],
  );

  const scopeName = hostFilter
    ? (deviceNames.get(hostFilter) ?? null)
    : null;

  return (
    <div className="mx-auto max-w-[1248px]">
      <PageHeader
        title="Logs"
        description="Every line the agents shipped, newest first."
        scope={scopeName}
      />

      {error && (
        <p className="mb-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Could not read hosts: {error}
        </p>
      )}

      {devices && devices.length === 0 ? (
        <p className="rounded-card border border-line bg-panel p-12 text-center text-sm text-muted shadow-card">
          No hosts yet. Add one from{" "}
          <Link href="/devices" className="font-medium text-accent">
            Hosts
          </Link>{" "}
          to start collecting logs.
        </p>
      ) : (
        <LogList
          deviceId={hostFilter}
          /*
            Tek makineye kısılmışken makine sütunu ÇİZİLMİYOR: her satırda aynı
            adı tekrar etmek, mesajın yerini boşa harcamak olurdu. Sayfanın
            başlığındaki "filtered to …" satırı zaten kapsamı söylüyor.
          */
          deviceNames={hostFilter ? undefined : deviceNames}
          /* Kendi sayfasında liste ekranın tamamını kullanıyor: 32rem'lik
             kutu, yanında künye ve grafik olan detay sayfası için ölçülmüştü;
             burada sayfada başka bir şey yok. */
          scrollerClass="max-h-[calc(100vh-15rem)]"
        />
      )}
    </div>
  );
}
