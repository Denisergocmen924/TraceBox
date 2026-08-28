/**
 * Ekran 3 — Cihaz detayı (CLAUDE.md §9.4).
 *
 * YER TUTUCU: 70/30 yerleşim, zaman çizelgesi, log listesi ve pause/sil
 * butonları bir sonraki dilimde gelir. Şimdilik yalnızca route param'ının
 * çalıştığını ve kartın kırık bağlantıya gitmediğini gösterir.
 */
"use client";

import { use } from "react";
import Link from "next/link";

export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/devices" className="text-sm text-muted hover:text-fg">
        ← Cihazlar
      </Link>
      <div className="mt-6 rounded-xl border border-line bg-panel p-6">
        <p className="text-sm text-muted">
          Cihaz detayı bir sonraki dilimde gelecek (§9.4).
        </p>
        <p className="mt-2 font-mono text-xs text-muted">{id}</p>
      </div>
    </main>
  );
}
