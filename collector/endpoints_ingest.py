"""
Cihazdan gelen yazma uçları: POST /inventory, POST /ingest, GET /verify.

Üçü de cihaz anahtarı ile korunur. Payload'da `device_id` YOKTUR; satırlara
`device_id` ve `account_id` doğrulanmış anahtardan eklenir.

Aynı ilkenin ikinci uygulaması `external_ip`tir: cihaz onu da GÖNDERMEZ.
Kimlik gibi, adres de cihazın kendi beyanı olamaz — değeri isteği gerçekten
alan taraf yazar (aşağıda `_external_ip`).
"""

from __future__ import annotations

import logging
from ipaddress import ip_address
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from auth import AuthenticatedDevice, DeviceIdentity
from db_access import call_or_503, server_now
from endpoints_commands import process_acks
from version import COLLECTOR_VERSION
from supabase_client import get_client

logger = logging.getLogger("tracebox.ingest")

router = APIRouter()

# Tek istekte kabul edilen azami satır sayısı (tablo başına). Agent spool'u
# 200 MB'a kadar birikebildiği için gönderim bu boyutta parçalara bölünür.
MAX_ROWS_PER_TABLE = 1000

# Payload alan adı ile sütun adının ayrıştığı tek yer: agent'ın ürettiği UUID
# tabloda birincil anahtardır.
UUID_FIELD = "uuid"
ID_COLUMN = "id"

# Dış IP'nin okunduğu başlık. Fly'ın proxy'si bunu KENDİSİ yazar ve istemcinin
# gönderdiği değeri ezer; `X-Forwarded-For` ise istemcinin önüne kendi
# uydurduğu adresleri ekleyebildiği bir listedir, yani kaynak olarak
# kullanılamaz.
#
# Başlık yoksa (yerel çalıştırma, başka bir barındırıcı) değer null kalır.
# Soketin karşı ucuna düşmek bir seçenek DEĞİL: proxy arkasında o adres
# proxy'nin kendisidir ve cihazın adresi diye kaydedilmesi, boş bırakmaktan
# daha kötüdür.
CLIENT_IP_HEADER = "Fly-Client-IP"

# Eklentinin adı burada TEKRAR tanımlanır; agent'tan import EDİLMEZ. İki taraf
# ayrı deploy edilen ayrı programlar (collector imajında agent kodu yok);
# paylaştıkları şey Python nesnesi değil, wire sözleşmesidir. Adın iki tarafta
# aynı kaldığını tests/test_ingest_external_ip.py sınar — aynı yöntem log
# seviyeleri ve flush sebepleri için de kullanılıyor.
EXTERNAL_IP_ADDON = "external_ip"


class _Payload(BaseModel):
    """Ortak model ayarları.

    `extra="forbid"`: sözleşmede olmayan bir alan sessizce yutulmaz, 422 döner.
    Yazım hatası taşıyan bir alan aksi halde null olarak kaydedilirdi.
    """

    model_config = ConfigDict(extra="forbid")


class InventoryIn(_Payload):
    """POST /inventory gövdesi — `devices` satırının üzerine yazılır."""

    cpu_model: str | None = None
    cpu_cores_physical: int | None = None
    cpu_cores_logical: int | None = None
    arch: str | None = None
    ram_total_mb: int | None = None
    disk_total_mb: int | None = None
    os_name: str | None = None
    os_version: str | None = None
    kernel_version: str | None = None
    last_boot: AwareDatetime | None = None
    agent_version: str | None = None
    gpu_model: str | None = None
    # external_ip BURADA YOK. `extra="forbid"` sayesinde alanın yokluğu pasif
    # bir eksiklik değil aktif bir REDDİR: göndermeye çalışan agent 422 alır.
    enabled_addons: list[str] = Field(default_factory=list)


class MetricIn(_Payload):
    """Bir ölçüm örneği. Eklenti alanları kapalıysa null gelir."""

    uuid: UUID
    measured_at: AwareDatetime
    cpu_percent: float | None = None
    ram_used_mb: int | None = None
    disk_percent: float | None = None
    net_sent_mb: float | None = None
    net_recv_mb: float | None = None
    temperature_c: float | None = None
    swap_used_mb: int | None = None
    load_avg_1: float | None = None
    load_avg_5: float | None = None
    load_avg_15: float | None = None
    gpu_usage_percent: float | None = None
    gpu_vram_used_mb: int | None = None


class LogIn(_Payload):
    """Bir log kaydı. `level` şemadaki check kısıtıyla aynı dört değeri alır."""

    uuid: UUID
    measured_at: AwareDatetime
    level: Literal["info", "warning", "error", "critical"]
    message: str
    source: str | None = None


class ProcessIn(_Payload):
    """Çöküş anındaki bir süreç — `crash_snapshots.processes` içine gömülür."""

    name: str
    cpu: float
    ram_mb: int


class CrashSnapshotIn(_Payload):
    """Acil flush anında alınan süreç görüntüsü."""

    uuid: UUID
    measured_at: AwareDatetime
    trigger_reason: Literal["cpu", "ram", "disk", "log"] | None = None
    processes: list[ProcessIn] = Field(default_factory=list)


class IngestIn(_Payload):
    """POST /ingest gövdesi — üç tablo ve komut ack'i tek istekte gelir."""

    metrics: Annotated[list[MetricIn], Field(max_length=MAX_ROWS_PER_TABLE)] = Field(
        default_factory=list
    )
    logs: Annotated[list[LogIn], Field(max_length=MAX_ROWS_PER_TABLE)] = Field(
        default_factory=list
    )
    crash_snapshots: Annotated[
        list[CrashSnapshotIn], Field(max_length=MAX_ROWS_PER_TABLE)
    ] = Field(default_factory=list)
    # Uygulanmış komutların id'leri (ack). Ayrı bir uç yerine bu gövdeye
    # binerler: agent zaten düzenli olarak buraya istek atıyor, ack için ikinci
    # bir tur açmak boşuna trafik olurdu.
    applied_command_ids: Annotated[
        list[UUID], Field(max_length=MAX_ROWS_PER_TABLE)
    ] = Field(default_factory=list)


@router.post("/inventory")
async def post_inventory(
    payload: InventoryIn,
    device: AuthenticatedDevice,
    fly_client_ip: Annotated[str | None, Header()] = None,
) -> dict:
    """Envanteri cihaz satırına yazar.

    Envanter zaman serisi değildir: her gönderim bir öncekinin üzerine yazar.

    `external_ip` gövdeden değil BAŞLIKTAN türetilir ve yalnızca burada yazılır.
    Adresin tazeliği envanterin tazeliği kadardır (açılışta + değiştiğinde);
    daha sık güncellemek `/ingest`e de aynı iki satırı koymak demek olurdu ama
    o zaman rızayı okumak için cihaz satırındaki `enabled_addons`a bakmak
    gerekirdi. Alan "statik eklenti" olarak tanımlandığı için bu değiş tokuş
    bugün yapılmadı.
    """
    fields = payload.model_dump(mode="json")
    fields["external_ip"] = _external_ip(fly_client_ip, payload.enabled_addons)
    fields["last_seen"] = server_now()

    await call_or_503(lambda: get_client().update_device(device.id, fields))
    return {"status": "ok", "device_name": device.device_name}


@router.post("/ingest")
async def post_ingest(payload: IngestIn, device: AuthenticatedDevice) -> dict:
    """Ölçüm, log ve çöküş kayıtlarını yazar.

    Tablolar ayrı isteklerle yazılır; ortada bir hata olursa istemci tüm batch'i
    tekrar gönderir ve daha önce yazılmış satırlar `id` çakışmasıyla elenir.
    """
    client = get_client()
    tables = (
        ("metrics", payload.metrics),
        ("logs", payload.logs),
        ("crash_snapshots", payload.crash_snapshots),
    )

    for table, items in tables:
        rows = [_row(item, device) for item in items]
        await call_or_503(lambda table=table, rows=rows: client.insert_rows(table, rows))

    # Ack, veri yazıldıktan SONRA işlenir: `delete` ack'i cihaz satırını siler ve
    # o satıra bağlı her şey CASCADE ile gider. Ters sırada, aynı gövdede gelen
    # ölçümler silinmiş bir cihaza yazılmaya çalışılırdı (foreign key hatası).
    ack = await process_acks(client, device, payload.applied_command_ids)

    if not ack.device_deleted:
        fields: dict[str, Any] = {"last_seen": server_now()}
        if ack.logging_enabled is not None:
            # pause/resume'un sunucu kopyası. Doğruluk kaynağı agent'ın
            # state.json'ı; bu sütun dashboard rozeti için tutulur ve bu yüzden
            # komut VERİLDİĞİNDE değil, agent UYGULADIĞINI bildirdiğinde yazılır.
            fields["logging_enabled"] = ack.logging_enabled
        await call_or_503(lambda: client.update_device(device.id, fields))

    return {
        "status": "ok",
        "accepted": {table: len(items) for table, items in tables},
    }


@router.get("/verify")
async def get_verify(device: AuthenticatedDevice) -> dict:
    """Kurulum sonu bağlantı testi — anahtar geçerliyse 200.

    Collector sürümü burada döner: kimliksiz uçlardan (`GET /`) alınmıştı, çünkü
    sürüm ifşası keşif kolaylığıdır. Bu uç zaten cihaz
    anahtarı istiyor, yani yeni bir kilit takmak yerine mevcut kilidin arkasına
    taşındı. Deploy sonrası "hangi sürüm canlıda?" sorusunun cevabı da burası.
    """
    return {
        "status": "ok",
        "device_name": device.device_name,
        "version": COLLECTOR_VERSION,
    }


def _external_ip(header_value: str | None, enabled_addons: list[str]) -> str | None:
    """Proxy'nin bildirdiği istemci adresi — eklenti kapalıysa None.

    Rıza her gönderimde YENİDEN sorulur ve kapalıyken açıkça None yazılır:
    kullanıcı eklentiyi kapattığında `enabled_addons` değiştiği için envanter
    zaten yeniden gönderilir, o gönderim de daha önce kaydedilmiş adresi siler.
    "Yazmamak" yetmezdi — eski değer satırda kalırdı.

    Değer ayrıca IP olarak ÇÖZÜLEBİLDİĞİ doğrulanır. Beklenmedik bir şey gelmesi
    proxy zincirinin varsayıldığı gibi olmadığını gösterir; onu olduğu gibi
    kaydetmek metin sütununa güvenilmeyen girdi yazmak olurdu.
    """
    if EXTERNAL_IP_ADDON not in enabled_addons:
        return None

    if not header_value:
        return None

    try:
        return str(ip_address(header_value.strip()))
    except ValueError:
        # Değerin kendisi loglanmaz: doğrulanmamış, dışarıdan gelen bir metin.
        logger.warning("%s başlığı IP adresi olarak çözülemedi", CLIENT_IP_HEADER)
        return None


def _row(item: BaseModel, device: DeviceIdentity) -> dict[str, Any]:
    """Payload kaydını tablo satırına çevirir: uuid → id, kimlik ve varış zamanı eklenir.

    `measured_at` agent'ta kalır — ölçümün GERÇEKTEN ne zaman alındığını yalnızca
    o bilir ve çöküşten sonra geç gönderilen veri de doğru anı taşımalıdır.
    Ama retention (silme işi) ona bakamaz: damgayı geleceğe atan
    veya saati bozuk bir cihazın verisi asla "eski" olmaz ve sonsuza kadar
    birikirdi. Bu yüzden `received_at`'i SUNUCU yazar ve silme ona bakar.
    """
    row = item.model_dump(mode="json")
    row[ID_COLUMN] = row.pop(UUID_FIELD)
    row["device_id"] = device.id
    row["account_id"] = device.account_id
    row["received_at"] = server_now()
    return row
