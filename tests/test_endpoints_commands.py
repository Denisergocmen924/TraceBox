"""
collector/endpoints_commands.py — komut kuyruğunun sunucu tarafı.

İki uç sınanır: komutun VERİLMESİ (`GET /commands`) ve uygulandığının
KAYDEDİLMESİ (`POST /ingest` gövdesindeki `applied_command_ids`). İkisi ayrı
dosyada durmaz çünkü aynı döngünün iki yarısıdır; ack ingest'e binmiş olsa da
mantığı bu modülde yaşar.

Buradaki hataların hepsi sessizdir: komut teslim edilmezse agent hiç
duraklamaz, ack işlenmezse aynı komut sonsuza kadar tekrar gelir, `delete`
yanlış sırada işlenirse cihaz kaydı ortada kalır. Hiçbiri istisna fırlatmaz.

Supabase taklit ediliyor (`get_client` sahte bir istemciyle değiştiriliyor) ve
cihaz doğrulaması bağımlılık override'ıyla sabitleniyor — anahtarın kendisi
zaten test_collector_security.py'de sınanıyor, burada sınanan uçların MANTIĞI.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import auth
import endpoints_commands
import endpoints_ingest
from main import app
from supabase_client import DEVICE_WRITABLE_COLUMNS, SupabaseError

DEVICE_ID = "33333333-3333-3333-3333-333333333333"
ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"

# Kurbanın cihazı — sahte istemcinin "yanlış cihaza dokunuldu mu?" kontrolü için.
OTHER_DEVICE_ID = "44444444-4444-4444-4444-444444444444"

PAUSE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
RESUME_ID = "aaaaaaaa-0000-0000-0000-000000000002"
DELETE_ID = "aaaaaaaa-0000-0000-0000-000000000003"


def command_row(command_id: str, command_type: str, created_at: str = "2026-08-26T10:00:00Z"):
    """`commands` tablosundan dönen satır."""
    return {"id": command_id, "type": command_type, "created_at": created_at}


class FakeSupabase:
    """Çağrıları sırasıyla kaydeden, ağa çıkmayan sahte istemci.

    `calls` listesi hem NE yapıldığını hem HANGİ SIRADA yapıldığını tutar;
    ack testlerinin bir kısmı yalnızca sıraya bakar.
    """

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.pending: list[dict] = []
        self.applied: list[dict] = []
        self.list_error: SupabaseError | None = None
        self.mark_error: SupabaseError | None = None
        self.delete_error: SupabaseError | None = None

    @property
    def call_names(self) -> list[str]:
        return [call[0] for call in self.calls]

    def last(self, name: str) -> tuple:
        """Adı verilen son çağrı — yoksa test AssertionError ile durur."""
        matches = [call for call in self.calls if call[0] == name]
        assert matches, f"{name} hiç çağrılmadı"
        return matches[-1]

    async def list_pending_commands(self, device_id: str) -> list[dict]:
        self.calls.append(("list_pending_commands", device_id))
        if self.list_error is not None:
            raise self.list_error
        return self.pending

    async def mark_commands_applied(
        self, device_id: str, command_ids: list[str], applied_at: str
    ) -> list[dict]:
        self.calls.append(("mark_commands_applied", device_id, command_ids, applied_at))
        if self.mark_error is not None:
            raise self.mark_error
        return self.applied

    async def delete_device(self, device_id: str) -> None:
        self.calls.append(("delete_device", device_id))
        if self.delete_error is not None:
            raise self.delete_error

    async def update_device(self, device_id: str, fields: dict) -> None:
        self.calls.append(("update_device", device_id, fields))

    async def insert_rows(self, table: str, rows: list[dict]) -> None:
        self.calls.append(("insert_rows", table, rows))


@pytest.fixture
def fake_supabase(monkeypatch):
    """İki uç noktayı da aynı sahte veritabanına bağlar."""
    client = FakeSupabase()
    monkeypatch.setattr(endpoints_commands, "get_client", lambda: client)
    monkeypatch.setattr(endpoints_ingest, "get_client", lambda: client)
    app.dependency_overrides[auth.require_device] = lambda: auth.DeviceIdentity(
        id=DEVICE_ID, account_id=ACCOUNT_ID, device_name="dizustu"
    )
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def client(fake_supabase):
    return TestClient(app)


def poll(client):
    """GET /commands — agent'ın komut sorması."""
    return client.get("/commands")


def ack(client, *command_ids, **body):
    """POST /ingest — ack piggyback. Gövde varsayılanı boş bir gönderimdir."""
    return client.post(
        "/ingest", json={"applied_command_ids": list(command_ids), **body}
    )


# --- GET /commands: komutun teslimi ----------------------------------------


def test_pending_commands_are_delivered(client, fake_supabase):
    """Bekleyen komut agent'a ulaşmalı — yoksa pause/resume/delete hiç çalışmaz."""
    fake_supabase.pending = [command_row(PAUSE_ID, "pause")]

    body = poll(client).json()

    assert body["commands"] == [{"id": PAUSE_ID, "type": "pause"}]


def test_empty_queue_returns_an_empty_list(client):
    """Komut yokken de aynı şekil dönmeli; agent tek bir kod yolu izler."""
    assert poll(client).json() == {"commands": []}


def test_only_the_authenticated_device_is_queried(client, fake_supabase):
    """Sorgu doğrulanmış anahtarın cihazına kilitli.

    İstekte device_id YOK (Boşluk A) — olsaydı bir cihaz başkasının komutlarını
    çekip onun agent'ından gizleyebilirdi.
    """
    poll(client)
    assert fake_supabase.last("list_pending_commands")[1] == DEVICE_ID


def test_only_id_and_type_reach_the_agent(client, fake_supabase):
    """Satırın diğer sütunları yanıta sızmamalı — sözleşme iki alandan ibaret."""
    fake_supabase.pending = [command_row(PAUSE_ID, "pause")]

    command = poll(client).json()["commands"][0]

    assert set(command) == {"id", "type"}


def test_poll_refreshes_last_seen(client, fake_supabase):
    """Bu dosyadaki en kolay kaçırılan davranış.

    Duraklatılmış agent veri göndermez ama komut sormayı sürdürür. `last_seen`
    yalnızca ingest'te yazılsaydı o cihaz dashboard'da OFFLINE görünürdü — oysa
    ulaşılabilir durumda ve `resume` komutunu bekliyor. Sütunun anlamı "veri
    geldi" değil, "cihazdan haber alındı".
    """
    poll(client)

    name, device_id, fields = fake_supabase.last("update_device")
    assert device_id == DEVICE_ID
    assert "last_seen" in fields


def test_database_failure_becomes_503(client, fake_supabase):
    """Komut listesi okunamazsa agent'a "sonra tekrar dene" denir."""
    fake_supabase.list_error = SupabaseError("kesinti")

    assert poll(client).status_code == 503


# --- Ack: pause / resume ---------------------------------------------------


def test_acked_commands_are_marked_applied(client, fake_supabase):
    """Ack işlenmezse aynı komut her poll'da tekrar gelir — sonsuz döngü."""
    fake_supabase.applied = [command_row(PAUSE_ID, "pause")]

    ack(client, PAUSE_ID)

    name, device_id, ids, applied_at = fake_supabase.last("mark_commands_applied")
    assert ids == [PAUSE_ID]
    assert applied_at


def test_ack_is_scoped_to_the_authenticated_device(client, fake_supabase):
    """Bir cihaz başkasının komutunu ack'leyemez.

    Ack'lenen komut `applied` olur ve bir daha teslim edilmez; kurbanın agent'ı
    o komutu hiç görmezdi.
    """
    fake_supabase.applied = [command_row(PAUSE_ID, "pause")]

    ack(client, PAUSE_ID)

    assert fake_supabase.last("mark_commands_applied")[1] == DEVICE_ID


def test_pause_ack_writes_the_server_copy(client, fake_supabase):
    """pause uygulandığında `devices.logging_enabled` false olur."""
    fake_supabase.applied = [command_row(PAUSE_ID, "pause")]

    ack(client, PAUSE_ID)

    assert fake_supabase.last("update_device")[2]["logging_enabled"] is False


def test_resume_ack_writes_the_server_copy(client, fake_supabase):
    """resume uygulandığında true olur."""
    fake_supabase.applied = [command_row(RESUME_ID, "resume")]

    ack(client, RESUME_ID)

    assert fake_supabase.last("update_device")[2]["logging_enabled"] is True


def test_plain_ingest_does_not_touch_logging_enabled(client, fake_supabase):
    """Ack yoksa sütuna dokunulmaz.

    Her gönderimde yazılsaydı sunucu kopyası, agent'ın gerçek durumunu değil
    son isteğin varsayılanını yansıtırdı.
    """
    ack(client)

    assert "logging_enabled" not in fake_supabase.last("update_device")[2]


def test_no_ack_skips_the_commands_table(client, fake_supabase):
    """Boş ack listesi için veritabanına hiç gidilmez — her 30 saniyede bir
    boşa yazma isteği anlamına gelirdi."""
    ack(client)

    assert "mark_commands_applied" not in fake_supabase.call_names


def test_state_comes_from_the_database_not_the_request(client, fake_supabase):
    """Agent yalnızca id gönderir; ne yapılacağını veritabanındaki `type` söyler.

    Tür gövdeden okunsaydı, cihaz kendi sunucu kopyasını istediği gibi
    yazabilirdi — hiç verilmemiş bir `resume`u bildirmek gibi.
    """
    fake_supabase.applied = [command_row(PAUSE_ID, "pause")]

    ack(client, PAUSE_ID)

    assert fake_supabase.last("update_device")[2]["logging_enabled"] is False


def test_the_last_command_wins(client, fake_supabase):
    """Aynı turda pause ve resume ack'lenirse SON verilen komut kazanır.

    Satırlar `created_at` artan sırada döner; döngü sonuncuyu yazar.
    """
    fake_supabase.applied = [
        command_row(PAUSE_ID, "pause", "2026-08-26T10:00:00Z"),
        command_row(RESUME_ID, "resume", "2026-08-26T10:05:00Z"),
    ]

    ack(client, PAUSE_ID, RESUME_ID)

    assert fake_supabase.last("update_device")[2]["logging_enabled"] is True


def test_written_fields_are_allowed_by_the_client(client, fake_supabase):
    """Uç noktanın yazdığı her sütun `DEVICE_WRITABLE_COLUMNS` içinde olmalı.

    Sahte istemci allowlist'i çalıştırmaz; gerçek istemci çalıştırır ve
    listede olmayan bir sütun canlıda ValueError olur — testte değil.
    """
    fake_supabase.applied = [command_row(PAUSE_ID, "pause")]

    ack(client, PAUSE_ID)

    assert set(fake_supabase.last("update_device")[2]) <= DEVICE_WRITABLE_COLUMNS


def test_failed_ack_becomes_503(client, fake_supabase):
    """Ack yazılamazsa 200 dönmemeli.

    200 dönseydi agent id'yi state'inden silerdi ve komut sonsuza kadar
    `pending` kalırdı: agent uyguladığını sanır, sunucu beklemeye devam eder.
    """
    fake_supabase.mark_error = SupabaseError("kesinti")

    assert ack(client, PAUSE_ID).status_code == 503


# --- Ack: delete -----------------------------------------------------------


def test_delete_ack_removes_the_device_row(client, fake_supabase):
    """Agent kendini sildiğini bildirince cihaz kaydı da gider (CASCADE)."""
    fake_supabase.applied = [command_row(DELETE_ID, "delete")]

    ack(client, DELETE_ID)

    assert fake_supabase.last("delete_device")[1] == DEVICE_ID


def test_delete_ack_deletes_only_the_authenticated_device(client, fake_supabase):
    """Silinen satır her zaman anahtarın sahibi — gövdeden gelen bir id değil."""
    fake_supabase.applied = [command_row(DELETE_ID, "delete")]

    ack(client, DELETE_ID)

    assert OTHER_DEVICE_ID not in fake_supabase.last("delete_device")


def test_delete_ack_does_not_write_the_row_afterwards(client, fake_supabase):
    """Satır silindikten sonra `last_seen` yazılmaya çalışılmamalı.

    PostgREST silinmiş satıra yapılan güncellemeyi hata saymaz — sessizce sıfır
    satır günceller. Yani bu yanlış canlıda hiç görünmez; yalnızca boşa bir
    istek olarak kalır ve delete akışının sırası bozulduğunda ilk kanıt budur.
    """
    fake_supabase.applied = [command_row(DELETE_ID, "delete")]

    ack(client, DELETE_ID)

    order = fake_supabase.call_names
    assert "update_device" not in order[order.index("delete_device"):]


def test_delete_wins_over_pause_in_the_same_batch(client, fake_supabase):
    """Aynı turda delete varsa cihaz gider; pause'un yazılacağı satır kalmaz."""
    fake_supabase.applied = [
        command_row(PAUSE_ID, "pause", "2026-08-26T10:00:00Z"),
        command_row(DELETE_ID, "delete", "2026-08-26T10:05:00Z"),
    ]

    ack(client, PAUSE_ID, DELETE_ID)

    assert "delete_device" in fake_supabase.call_names
    assert "update_device" not in fake_supabase.call_names


def test_failed_delete_becomes_503(client, fake_supabase):
    """Cihaz satırı silinemezse agent 200 almamalı.

    200 alsaydı yerel wipe'ı yapar ve anahtarını silerdi; kayıt sunucuda öksüz
    kalır, bir daha kimse onu silmeye zorlayamazdı (force remove hariç).
    """
    fake_supabase.applied = [command_row(DELETE_ID, "delete")]
    fake_supabase.delete_error = SupabaseError("kesinti")

    assert ack(client, DELETE_ID).status_code == 503


# --- Ack ile veri yazımının sırası -----------------------------------------


def test_rows_are_written_before_the_delete_ack(client, fake_supabase):
    """Aynı gövdedeki son ölçümler, cihaz satırı silinmeden önce yazılmalı.

    Ters sırada foreign key ihlali olurdu: `metrics.device_id` artık var olmayan
    bir satırı gösterirdi. Ve tam olarak bu veri en değerlisidir — çöküşten
    hemen önceki son kayıtlar.
    """
    fake_supabase.applied = [command_row(DELETE_ID, "delete")]

    ack(
        client,
        DELETE_ID,
        logs=[
            {
                "uuid": "bbbbbbbb-0000-0000-0000-000000000001",
                "measured_at": "2026-08-26T10:00:00Z",
                "level": "critical",
                "message": "son soz",
            }
        ],
    )

    order = fake_supabase.call_names
    assert order.index("insert_rows") < order.index("delete_device")
