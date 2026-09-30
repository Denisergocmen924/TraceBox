"""
Hesap silme ucu: DELETE /account.

Bu uç da `POST /devices` gibi tarayıcıdan çağrılıyor — cihaz anahtarıyla değil
kullanıcı JWT'siyle korunuyor. `account_id` gövdeden DEĞİL, doğrulanmış
token'dan (`sub`) alınır; yani bir kullanıcı gövdeye başka bir id yazıp başka
bir hesabı hedef alamaz, silebileceği tek şey kendi hesabıdır.

Dashboard buraya yalnızca §9.10'un öngördüğü iki aşamalı onaydan (yazılı
onay metni + son "Are you sure" penceresi) SONRA ulaşır; bu uç onay akışını
kendisi tekrarlamaz, tamamen tarayıcı tarafının sorumluluğundadır.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from auth import AuthenticatedUser
from supabase_client import SupabaseError, get_client

router = APIRouter()


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_account(user: AuthenticatedUser) -> None:
    """Giriş yapmış kullanıcının hesabını ve TÜM verisini kalıcı olarak siler.

    Silme `auth.users` satırından başlar (bkz. `supabase_client.delete_account`)
    ve CASCADE zinciriyle accounts/devices/metrics/logs/crash_snapshots/commands
    satırlarının tamamını götürür — ayrıca bir temizlik adımı yok, kalıntı
    kalmıyor.
    """
    try:
        await get_client().delete_account(user.account_id)
    except SupabaseError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The account could not be deleted right now.",
        ) from error
