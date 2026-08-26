"""
Komut uçları: GET /commands ve `POST /ingest` gövdesindeki ack'in işlenmesi.

Kuyruk tek yönlü akar: dashboard `commands` tablosuna `pending` bir satır ekler,
agent onu poll ile alır, uygular ve id'sini bir sonraki gönderimde geri yollar.
Bu modül o döngünün sunucu tarafındaki iki ucunu tutar — komutu VERMEK ve
uygulandığını KAYDETMEK.

Ack'in işlenmesi burada durur, `endpoints_ingest`'te değil: komutun durumunu
değiştiren tek yer burasıdır, ingest yalnızca çağırır.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter

from auth import AuthenticatedDevice, DeviceIdentity
from db_access import call_or_503, server_now
from supabase_client import get_client

router = APIRouter()

# Komut türünün `logging_enabled` sunucu kopyasına karşılığı. `delete` burada
# yok: o komut satırı hiç bırakmaz, cihaz kaydının tamamı silinir.
LOGGING_STATE_BY_TYPE = {"pause": False, "resume": True}

DELETE_COMMAND = "delete"


@dataclass(frozen=True)
class AckResult:
    """Ack işlendikten sonra çağıranın bilmesi gerekenler.

    `device_deleted`: cihaz satırı silindi — geriye yazılacak bir satır yok.
    `logging_enabled`: pause/resume uygulandıysa yeni durum, yoksa None.
    """

    device_deleted: bool = False
    logging_enabled: bool | None = None


@router.get("/commands")
async def get_commands(device: AuthenticatedDevice) -> dict:
    """Cihazın bekleyen komutlarını döndürür.

    `last_seen` burada da tazelenir. Duraklatılmış (pause) bir agent veri
    göndermeyi durdurur ama komut poll'ünü sürdürür — yoksa `resume` ona hiç
    ulaşmazdı. Yalnızca ingest `last_seen` yazsaydı, o cihaz susduğu için
    dashboard'da "offline" görünürdü; oysa erişilebilir durumda. Sütunun anlamı
    bu yüzden "veri geldi" değil, "cihazdan haber alındı".
    """
    client = get_client()

    commands = await call_or_503(lambda: client.list_pending_commands(device.id))
    await call_or_503(
        lambda: client.update_device(device.id, {"last_seen": server_now()})
    )

    return {"commands": [{"id": row["id"], "type": row["type"]} for row in commands]}


async def process_acks(
    client, device: DeviceIdentity, command_ids: list[UUID]
) -> AckResult:
    """Ack edilen komutları `applied` yapar ve doğurduğu durumu uygular.

    Sıra önemlidir:
      1. komutlar `applied` işaretlenir ve güncellenen satırlar geri okunur,
      2. dönen satırlarda `delete` varsa cihaz satırı silinir (CASCADE),
      3. yoksa pause/resume'un getirdiği `logging_enabled` çağırana bildirilir.

    Uygulanacak durum, agent'ın gövdesinden değil veritabanından dönen `type`
    alanından türetilir; agent'ın gönderdiği tek şey komut id'sidir.

    Aynı turda birden fazla pause/resume gelirse EN SON verilen komut kazanır:
    satırlar `created_at` artan sırada döner ve döngü sonuncuyu yazar.
    """
    if not command_ids:
        return AckResult()

    applied = await call_or_503(
        lambda: client.mark_commands_applied(
            device.id, [str(cid) for cid in command_ids], server_now()
        )
    )

    logging_enabled: bool | None = None
    for row in applied:
        if row["type"] == DELETE_COMMAND:
            # Silme her şeyin önüne geçer: satır gidince pause/resume'un
            # yazılacağı yer de kalmaz.
            await call_or_503(lambda: client.delete_device(device.id))
            return AckResult(device_deleted=True)

        if row["type"] in LOGGING_STATE_BY_TYPE:
            logging_enabled = LOGGING_STATE_BY_TYPE[row["type"]]

    return AckResult(logging_enabled=logging_enabled)
