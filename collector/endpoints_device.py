"""
Cihaz kaydı ucu: POST /devices.

Bu uç agent'ın değil DASHBOARD'un çağırdığı tek yazma ucudur; bu yüzden cihaz
anahtarıyla değil kullanıcı JWT'siyle korunur. Cihazın anahtarı burada üretilir:
veritabanına yalnızca SHA-256 özeti (`devices.key_hash`) yazılır, düz hali tek
seferlik yanıtta döner ve hiçbir yerde saklanmaz.

`device_id` de burada doğar — sunucu üretir (`gen_random_uuid()`), istemci
seçemez.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, StringConstraints

from auth import AuthenticatedUser
from hashing import generate_device_key, hash_device_key
from supabase_client import UNIQUE_VIOLATION, SupabaseError, get_client

router = APIRouter()

# Cihaz adı için üst sınır. Sütun tipi `text`, yani veritabanı tarafında sınır
# yok; kontrol burada, satır oluşturulmadan önce yapılır.
MAX_DEVICE_NAME_LENGTH = 64

# Baştaki/sondaki boşluklar kırpılır, sonra uzunluk kontrol edilir. Kırpma önce
# yapıldığı için yalnızca boşluktan oluşan bir ad boş sayılır ve reddedilir.
DeviceName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_DEVICE_NAME_LENGTH,
    ),
]


class DeviceCreateIn(BaseModel):
    """POST /devices gövdesi.

    `extra="forbid"`: sözleşmede olmayan alan sessizce yutulmaz, 422 döner.
    Burada bu ayarın ayrı bir önemi var — `account_id` veya `key_hash` gibi bir
    alanı gövdeye yazmayı deneyen istek, hiç işlenmeden reddedilir.
    """

    model_config = ConfigDict(extra="forbid")

    device_name: DeviceName


@router.post("/devices", status_code=status.HTTP_201_CREATED)
async def post_devices(payload: DeviceCreateIn, user: AuthenticatedUser) -> dict:
    """Yeni cihaz oluşturur ve anahtarını BİR KEZ döndürür.

    Satırın `account_id`'si gövdeden değil doğrulanmış token'dan alınır; yani
    kullanıcı cihazı başka bir hesabın altına açamaz.

    Aynı hesapta aynı adı taşıyan bir cihaz varsa `devices (account_id,
    device_name)` unique indeksi devreye girer ve 409 döner. Bu, kullanıcının
    düzeltebileceği kalıcı bir durumdur — tekrar denemesi anlamsız olduğu için
    503 değil 409 verilir.
    """
    device_key = generate_device_key()

    row = {
        "account_id": user.account_id,
        "device_name": payload.device_name,
        "key_hash": hash_device_key(device_key),
    }

    try:
        created = await get_client().insert_device(row)
    except SupabaseError as error:
        if error.code == UNIQUE_VIOLATION:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A host with this name already exists in this account.",
            ) from error

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The host could not be created right now.",
        ) from error

    # `device_key` yalnızca bu yanıtta görünür. Kaybedilirse geri getirilemez;
    # veritabanında yalnızca özeti var.
    return {
        "device_id": created["id"],
        "device_name": payload.device_name,
        "device_key": device_key,
    }
