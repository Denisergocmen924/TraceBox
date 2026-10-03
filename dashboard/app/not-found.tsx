/**
 * 404 — kök düzeyde tek sayfa; hem oturum açmış hem açmamış ziyaretçi görür.
 *
 * `(app)` kabuğunun (kenar çubuğu, oturum kapısı) DIŞINDA durur: bilinmeyen bir
 * adrese gelen kişinin oturumu olup olmadığını bilmiyoruz, kabuk giriş ister
 * ve 404 yerine giriş ekranı gösterirdi. Bu yüzden yalnızca marka + iki çıkış.
 * `/` zaten oturuma göre Overview'a ya da girişe yönlendiriyor.
 */
import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Image
        src="/mascot-lost.png"
        alt=""
        width={768}
        height={512}
        priority
        className="h-auto w-72 select-none"
        draggable={false}
      />
      <p className="mt-2 text-6xl font-bold tracking-tight text-accent">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        This page doesn&apos;t exist or has moved. Maybe the address has a typo?
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong"
      >
        Back to home
      </Link>
    </main>
  );
}
