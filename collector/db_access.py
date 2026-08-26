"""
Cihaz uçlarının paylaştığı iki küçük yardımcı: sunucu saati ve 503 sarmalayıcı.

`endpoints_ingest` ile `endpoints_commands` aynı iki davranışa ihtiyaç duyar;
ikisini de tek bir uç noktanın modülünde tutmak ya kopyalamayı ya da bir uç
noktanın diğerinin iç adlarını içe aktarmasını gerektirirdi.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from supabase_client import SupabaseError


def server_now() -> str:
    """`last_seen` ve `applied_at` için sunucu saati (ISO 8601, UTC).

    Agent'ın damgası kullanılmaz: saati kaymış bir cihaz aksi halde offline
    tespitini yanıltırdı.
    """
    return datetime.now(timezone.utc).isoformat()


async def call_or_503(operation):
    """Supabase çağrısını çalıştırır, sonucunu döndürür; hatayı 503'e çevirir.

    503, agent'a "veriyi tut, sonra tekrar dene" demektir; spool kaydı ancak 200
    sonrası silinir. Aynı kural komut ack'i için de geçerlidir: ack yazılamazsa
    agent id'yi state'inde tutar ve bir sonraki gönderimde tekrar yollar.
    """
    try:
        return await operation()
    except SupabaseError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kayıt şu an yazılamıyor.",
        ) from error
