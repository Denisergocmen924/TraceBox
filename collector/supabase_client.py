"""
Supabase'e yazma katmanı — PostgREST üzerinden, service key ile.

Service key RLS'i bypass eder; bu yüzden `account_id` ve `device_id` filtreleri
bu modülü çağıran kodun sorumluluğundadır.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("tracebox.supabase")

SUPABASE_URL_ENV = "SUPABASE_URL"
SUPABASE_SERVICE_KEY_ENV = "SUPABASE_SERVICE_KEY"

# PostgREST'in taban yolu. Kod bunu kendisi eklediği için `SUPABASE_URL`
# yalnızca proje adresini taşımalıdır.
REST_PATH = "/rest/v1"

# Fly makinesi ile Supabase aynı coğrafyada (fra / eu-central-1); bu süre normal
# bir yazma için fazlasıyla yeterlidir. Aşılırsa agent spool'unda veri durur ve
# bir sonraki turda tekrar denenir.
REQUEST_TIMEOUT_SECONDS = 10.0

# PostgREST'in çakışan satırları sessizce atlaması için gereken başlık.
# `id` birincil anahtar olduğundan ON CONFLICT (id) DO NOTHING ile aynı sonucu
# verir.
PREFER_IGNORE_DUPLICATES = "resolution=ignore-duplicates,return=minimal"

# Yanıt gövdesi istenmediğinde kullanılır — güncelleme sonrası satırı geri
# okumaya gerek yok.
PREFER_MINIMAL = "return=minimal"

# Eklenen satırın geri okunması gerektiğinde kullanılır. Cihaz kaydında `id`
# sunucuda üretilir (`gen_random_uuid()`), yani çağıran onu ancak yanıttan
# öğrenebilir.
PREFER_REPRESENTATION = "return=representation"

# Postgres'in "tekrar eden anahtar" hata kodu (unique kısıt ihlali). Cihaz
# kaydında `devices (account_id, device_name)` unique indeksi bunu üretir.
UNIQUE_VIOLATION = "23505"

# Collector'ın `devices` satırında yazmasına izin verilen sütunlar.
#
# Bu liste bir YETKİ sınırıdır; `endpoints_ingest.InventoryIn` ise agent'ın ne
# gönderdiğini tarif eden bir SÖZLEŞMEDİR. İkisi bilerek ayrı tutulur: allowlist
# modelden türetilseydi, modele eklenen her alan kendiliğinden yazma izni
# kazanır ve bu ikinci duvar hiç var olmazdı.
#
# Listede ASLA yer almayacaklar ve nedenleri:
#   id, account_id  — cihazın hangi hesaba ait olduğunu tanımlar. Yazılabilir
#                     olsalardı bir cihaz kendini başka bir hesaba taşıyıp o
#                     hesabın dashboard'una veri enjekte edebilirdi.
#   key_hash        — kimlik kanıtının kendisi; cihaz kendi anahtarını seçemez.
#   device_name     — dashboard'un alanı (db/rls.sql: grant update (device_name)).
#
# logging_enabled M6'da listeye EKLENDİ (bkz. md/memory/decisions.md → "Komutlar
# (M6)"): pause/resume durumunun sunucu kopyasını, agent komutu ack'leyince
# collector yazar. Değer istek gövdesinden gelmez — `commands` satırındaki
# `type` alanından türetilir; agent'ın gönderdiği tek şey komut id'sidir.
#
# Buraya sütun eklemek bilinçli bir güvenlik kararıdır.
DEVICE_WRITABLE_COLUMNS = frozenset(
    {
        # komut ack'inin türettiği durum
        "logging_enabled",
        # agent'ın envanterden bildirdikleri (InventoryIn ile aynı 13 alan)
        "cpu_model",
        "cpu_cores_physical",
        "cpu_cores_logical",
        "arch",
        "ram_total_mb",
        "disk_total_mb",
        "os_name",
        "os_version",
        "kernel_version",
        "last_boot",
        "agent_version",
        "gpu_model",
        "enabled_addons",
        # sunucunun kendi bildiklerinden yazdıkları: varış anı ve bağlantının
        # geldiği adres. external_ip listede ama InventoryIn'de DEĞİL — cihaz
        # onu gönderemez, collector proxy başlığından türetir (M7).
        "last_seen",
        "external_ip",
    }
)


class SupabaseError(RuntimeError):
    """Supabase'e yazma/okuma başarısız oldu.

    `code`, PostgREST yanıtındaki Postgres hata kodudur (`23505` = tekrar eden
    anahtar gibi). Ağ hatalarında yanıt hiç oluşmadığı için `"?"` kalır.
    Çağıran katman buna bakarak kalıcı bir çakışmayı (409) geçici bir
    arızadan (503) ayırır.
    """

    def __init__(self, message: str, code: str = "?") -> None:
        super().__init__(message)
        self.code = code


class SupabaseClient:
    """PostgREST istemcisi. Uygulama ömrü boyunca tek örnek yaşar."""

    def __init__(self, url: str, service_key: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=f"{url}{REST_PATH}",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def find_device_by_key_hash(self, key_hash: str) -> dict[str, Any] | None:
        """Anahtar hash'ine karşılık gelen cihaz satırını döndürür, yoksa None."""
        response = await self._request(
            "GET",
            "/devices",
            params={
                "key_hash": f"eq.{key_hash}",
                "select": "id,account_id,device_name,key_hash,logging_enabled",
                "limit": "1",
            },
        )
        rows = response.json()
        return rows[0] if rows else None

    async def update_device(self, device_id: str, fields: dict[str, Any]) -> None:
        """Cihaz satırının verilen sütunlarının üzerine yazar.

        Yalnızca `DEVICE_WRITABLE_COLUMNS` içindeki sütunlara dokunulur. Bu
        kontrol, çağıran katmandaki doğrulamanın (Pydantic `extra="forbid"`)
        ikinci duvarıdır: service key RLS'i bypass ettiği için burada yakalanmayan
        bir sütun doğrudan Postgres'e yazılırdı.
        """
        forbidden = sorted(set(fields) - DEVICE_WRITABLE_COLUMNS)
        if forbidden:
            # Yalnızca sütun ADLARI loglanır — değerler loglanmaz; reddedilen
            # alan `key_hash` gibi bir sır olabilir.
            logger.error(
                "devices güncellemesi reddedildi — izinsiz sütun: %s",
                ", ".join(forbidden),
            )
            raise ValueError(
                f"devices tablosunda yazılamayacak sütun(lar): {', '.join(forbidden)}"
            )

        await self._request(
            "PATCH",
            "/devices",
            params={"id": f"eq.{device_id}"},
            json=fields,
            headers={"Prefer": PREFER_MINIMAL},
        )

    async def insert_device(self, row: dict[str, Any]) -> dict[str, Any]:
        """Yeni cihaz satırı ekler ve oluşan satırı (`id` ile birlikte) döndürür.

        `insert_rows` bu iş için kullanılamaz: o metot `ignore-duplicates`
        başlığıyla çalışır ve çakışan satırı sessizce atlar. Cihaz kaydında
        çakışma (aynı hesapta aynı ad) sessizce geçilecek bir durum değil,
        çağırana bildirilmesi gereken bir hatadır — bu yüzden istek o başlık
        olmadan gönderilir ve `SupabaseError.code` üzerinden ayırt edilir.
        """
        response = await self._request(
            "POST",
            "/devices",
            json=[row],
            params={"select": "id"},
            headers={"Prefer": PREFER_REPRESENTATION},
        )

        rows = response.json()
        if not rows:
            # PostgREST temsil istendiğinde satırı döndürür; boş gövde
            # beklenmedik bir durumdur ve sessizce geçilmemelidir.
            raise SupabaseError("POST /devices: oluşturulan satır okunamadı")

        return rows[0]

    async def delete_device(self, device_id: str) -> None:
        """Cihaz satırını siler.

        Yalnızca `delete` komutunun ack'i bu yola girer. Satırla birlikte
        metrics / logs / crash_snapshots / commands satırları da gider — şemadaki
        foreign key'ler `on delete cascade` taşır.
        """
        await self._request(
            "DELETE",
            "/devices",
            params={"id": f"eq.{device_id}"},
            headers={"Prefer": PREFER_MINIMAL},
        )

    async def list_pending_commands(self, device_id: str) -> list[dict[str, Any]]:
        """Cihazın bekleyen komutlarını eskiden yeniye döndürür.

        Filtre `device_id` ile sınırlıdır: service key RLS'i bypass ettiği için
        satır sahipliğini bu sorgu kurar. Sıra `created_at` artan — agent birden
        fazla komutu tek turda alırsa verildikleri sırayla uygular.
        """
        response = await self._request(
            "GET",
            "/commands",
            params={
                "device_id": f"eq.{device_id}",
                "status": "eq.pending",
                "select": "id,type",
                "order": "created_at.asc",
            },
        )
        return response.json()

    async def mark_commands_applied(
        self, device_id: str, command_ids: list[str], applied_at: str
    ) -> list[dict[str, Any]]:
        """Verilen komutları `applied` yapar ve GERÇEKTEN güncellenen satırları döndürür.

        İki filtre birden uygulanır: `id` listede olacak VE satır bu cihaza ait
        olacak. İkincisi olmasaydı bir cihaz, başka bir cihazın komutunu
        ack'leyip onu uygulanmış gösterebilirdi — kurbanın agent'ı komutu hiç
        görmezdi (agent yalnızca `pending` olanları çeker).

        `status` filtresi BİLEREK yok: zaten `applied` olan bir komut yeniden
        yazılır. Ack tekrarı normaldir (200 yolda kaybolursa agent aynı id'yi
        bir daha yollar) ve dönen satırlar delete akışının tetikleyicisidir —
        `applied` olanları eleseydik, ilk turda satır silme adımı yarım kalan
        bir delete bir daha asla tamamlanamazdı. Bedeli: tekrar eden ack
        `applied_at`'i tazeler.

        Dönen satırlar `type` alanını taşır; çağıran hangi durumun uygulanacağını
        (pause/resume/delete) buradan öğrenir — agent'ın gövdesinden değil.
        """
        if not command_ids:
            return []

        id_list = ",".join(command_ids)
        response = await self._request(
            "PATCH",
            "/commands",
            params={
                "id": f"in.({id_list})",
                "device_id": f"eq.{device_id}",
                "select": "id,type,created_at",
                "order": "created_at.asc",
            },
            json={"status": "applied", "applied_at": applied_at},
            headers={"Prefer": PREFER_REPRESENTATION},
        )
        return response.json()

    async def insert_rows(self, table: str, rows: list[dict[str, Any]]) -> None:
        """Satırları ekler; `id` çakışanları sessizce atlar."""
        if not rows:
            return

        await self._request(
            "POST",
            f"/{table}",
            json=rows,
            headers={"Prefer": PREFER_IGNORE_DUPLICATES},
        )

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        """İstek atar; ağ hatasını ve 4xx/5xx yanıtını SupabaseError'a çevirir."""
        # Hata metni `fly logs` çıktısına düşer; dışarıya dönen yanıt genel
        # kalır (auth.py / endpoints_ingest.py 503'e çevirir).
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as error:
            logger.error("Supabase %s %s ulaşılamadı: %r", method, path, error)
            raise SupabaseError(f"{method} {path}: {error}") from error

        if response.is_error:
            code = _error_code(response)
            logger.error(
                "Supabase %s %s → %s (kod: %s)",
                method,
                path,
                response.status_code,
                code,
            )
            raise SupabaseError(f"{method} {path}: {response.status_code}", code=code)

        return response


def _error_code(response: httpx.Response) -> str:
    """PostgREST hata yanıtından yalnızca `code` alanını çıkarır.

    Yanıtın geri kalanı (`message`, `details`, `hint`) bilerek loglanmaz:
    PostgREST bu alanlarda reddedilen satırın İÇERİĞİNİ geri gönderebilir ve o
    içerik kullanıcının sistem log'u olabilir. Log'a düşerse veri, veritabanının
    dışında ikinci bir yerde daha durmuş olur (`fly logs`).

    Hata kodu ise sabit bir Postgres numarasıdır (23505 = tekrar eden anahtar,
    23503 = eksik foreign key); veri taşımaz ama arızayı teşhis etmeye yeter.
    """
    try:
        body = response.json()
    except ValueError:
        return "?"

    if isinstance(body, dict) and body.get("code"):
        return str(body["code"])
    return "?"


_client: SupabaseClient | None = None

# Normalize edilmiş proje adresi. PostgREST yolu `SupabaseClient` içinde
# gömülüdür; Supabase'in DİĞER yolları (auth.py'nin çektiği JWKS belgesi) bu
# taban adresten türetilir.
_project_url: str | None = None


def _normalize_url(raw: str) -> str:
    """Proje adresini sondaki `/` ve `/rest/v1` ekinden arındırır.

    Değişkene REST adresinin tamamı girilirse yol iki kez eklenir ve Supabase
    404 (PGRST125) döner.
    """
    url = raw.strip().rstrip("/")
    if url.endswith(REST_PATH):
        url = url[: -len(REST_PATH)]

    return url


def init_client() -> SupabaseClient:
    """İstemciyi ortam değişkenlerinden kurar (uygulama açılışında bir kez).

    Değişkenler eksikse burada hata verilir: süreç ayağa kalkmaz, Fly sağlık
    kontrolünde çakılır ve deploy bir önceki sürümde kalır.
    """
    global _client, _project_url

    url = _normalize_url(os.environ.get(SUPABASE_URL_ENV, ""))
    service_key = os.environ.get(SUPABASE_SERVICE_KEY_ENV, "").strip()
    missing = [
        name
        for name, value in ((SUPABASE_URL_ENV, url), (SUPABASE_SERVICE_KEY_ENV, service_key))
        if not value
    ]
    if missing:
        raise RuntimeError(f"Eksik ortam değişkeni: {', '.join(missing)}")

    # Yalnızca adres ve anahtarın ön eki loglanır — anahtarın kendisi asla.
    logger.info("Supabase hedefi: %s (anahtar: %s…)", url, service_key[:11])

    _project_url = url
    _client = SupabaseClient(url, service_key)
    return _client


async def close_client() -> None:
    """Açık bağlantıları kapatır (uygulama kapanışında)."""
    global _client, _project_url

    if _client is not None:
        await _client.aclose()
        _client = None

    _project_url = None


def get_client() -> SupabaseClient:
    """Kurulmuş istemciyi döndürür — endpoint'ler bunu kullanır."""
    if _client is None:
        raise RuntimeError("Supabase istemcisi kurulmadı.")

    return _client


def get_project_url() -> str:
    """Supabase projesinin taban adresini döndürür (REST yolu eklenmemiş hâli).

    `auth.py` bunu iki yerde kullanır: JWKS belgesinin adresini kurmak ve
    token'daki `iss` alanının beklenen değerini hesaplamak.
    """
    if _project_url is None:
        raise RuntimeError("Supabase istemcisi kurulmadı.")

    return _project_url
