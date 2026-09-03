/**
 * "Bu tarayıcıda giriş yapılmış mı?" sorusunun tek cevabı.
 *
 * Üç hâl döner ve üçü de birbirinden AYRIDIR:
 *   status = "loading"  → henüz bilmiyoruz (Supabase depodan oturumu okuyor)
 *   status = "signedIn" → oturum var
 *   status = "signedOut"→ oturum yok
 *
 * "Bilmiyorum" hâlini "giriş yapılmamış" ile birleştirmek klasik hatadır:
 * sayfa bir an giriş ekranına atar, oturum okunduktan sonra geri döner —
 * kullanıcı her yenilemede ekranın titrediğini görür.
 */
"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SessionState =
  | { status: "loading"; session: null }
  | { status: "signedIn"; session: Session }
  | { status: "signedOut"; session: null };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    status: "loading",
    session: null,
  });

  useEffect(() => {
    let alive = true;

    supabase().auth.getSession().then(({ data }) => {
      if (!alive) return;
      setState(
        data.session
          ? { status: "signedIn", session: data.session }
          : { status: "signedOut", session: null },
      );
    });

    // Çıkış, token yenileme ve başka sekmede yapılan giriş buradan gelir.
    const { data: sub } = supabase().auth.onAuthStateChange((_event, session) => {
      setState(
        session
          ? { status: "signedIn", session }
          : { status: "signedOut", session: null },
      );
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
