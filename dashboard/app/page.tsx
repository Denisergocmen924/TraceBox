/**
 * Kök adres bir ekran değil, bir yol ayrımı: oturum varsa Overview'a,
 * yoksa giriş ekranına gönderir. Kendi başına hiçbir şey göstermez.
 */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";

export default function Home() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return; // "bilmiyorum" hâlinde yönlendirme YOK
    router.replace(status === "signedIn" ? "/overview" : "/login");
  }, [status, router]);

  return null;
}
