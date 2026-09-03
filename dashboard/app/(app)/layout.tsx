/**
 * Uygulama kabuğu: sol sidebar + üst toolbar + içerik alanı.
 *
 * Route grubu `(app)` parantez içinde olduğu için ADRESTE GÖRÜNMEZ — /devices
 * yine /devices. Grubun tek işi bu kabuğu paylaşan sayfaları bir araya
 * toplamak; giriş ekranı (§9.12) kabuğun dışında kalıyor, çünkü orada henüz
 * gezinecek bir hesap yok.
 *
 * Oturum kontrolü de burada, tek yerde. Daha önce her sayfa kendi kontrolünü
 * yapıyordu; yeni bir sayfa eklendiğinde kontrolü unutmak, o sayfayı sessizce
 * korumasız bırakırdı. (Asıl koruma RLS'te — burası yalnızca kullanıcıyı boş
 * ekranla baş başa bırakmamak için.)
 */
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppProvider } from "@/lib/appState";
import { useSession } from "@/lib/useSession";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status, session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
  }, [status, router]);

  // Sayfa değişince çekmece kapanır. Kapanmasaydı dar ekranda kullanıcı bir
  // cihaza tıkladıktan sonra açık menünün arkasında kalırdı.
  useEffect(() => setMenuOpen(false), [pathname]);

  // "loading" ile "signedOut" ayrı tutuluyor (lib/useSession.ts): ikisini
  // birleştirmek her yenilemede giriş ekranına bir anlık sıçrama demek.
  if (status !== "signedIn") {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  return (
    /* accounts.id = auth.users.id (§5), yani oturumdaki kullanıcı kimliği aynı
       zamanda hesap kimliği. commands satırı eklerken account_id kolonu bununla
       doldurulacak; RLS ikisinin eşit olmasını arıyor. */
    <AppProvider email={session.user.email ?? ""} accountId={session.user.id}>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      {/* Sidebar `fixed`; içerik geniş ekranda onun genişliği kadar içeri alınır.
          Ölçü --sidebar-w değişkeninden geliyor (app/globals.css), yani çubuk
          ve boşluk tek bir sayıyı paylaşıyor. */}
      <div className="lg:pl-(--sidebar-w)">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        {/* Yatay boşluk 30px — referansta kenar çubuğunun çizgisi ile ilk
            kartın kenarı arasındaki ölçü. */}
        <main className="px-4 py-6 sm:px-[30px]">{children}</main>
      </div>
    </AppProvider>
  );
}
