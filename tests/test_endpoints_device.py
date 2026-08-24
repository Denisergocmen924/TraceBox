"""
collector/endpoints_device.py — POST /devices.

Sistemdeki tek anahtar üretme noktası. Buradaki hata iki yönde de ağırdır:
anahtar sızarsa cihaz taklit edilir, `account_id` yanlış alınırsa kullanıcı
başka bir hesabın altına cihaz açar.

Supabase taklit ediliyor: `get_client` sahte bir istemciyle değiştiriliyor,
böylece testler ne ağa çıkıyor ne de bir servis anahtarına ihtiyaç duyuyor.
Kimlik doğrulaması da FastAPI'nin bağımlılık override'ıyla devre dışı —
JWT'nin kendisi zaten test_auth_user.py'de sınanıyor, burada sınanan uç
noktanın MANTIĞI.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import auth
import endpoints_device
from endpoints_device import MAX_DEVICE_NAME_LENGTH
from hashing import KEY_PREFIX, hash_device_key
from main import app
from supabase_client import UNIQUE_VIOLATION, SupabaseError

ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"

# Sunucunun ürettiği kimlik. İstemci bunu seçemez; sahte istemci de gerçek
# Supabase gibi kendi ürettiği değeri döndürür.
GENERATED_DEVICE_ID = "99999999-9999-9999-9999-999999999999"

# Saldırganın kendi hesabı — gövdeye yazmayı deneyeceği değer.
OTHER_ACCOUNT_ID = "22222222-2222-2222-2222-222222222222"


class FakeSupabase:
    """`insert_device` çağrılarını kaydeden, ağa çıkmayan sahte istemci."""

    def __init__(self, error: SupabaseError | None = None) -> None:
        self.error = error
        self.rows: list[dict] = []

    async def insert_device(self, row: dict) -> dict:
        self.rows.append(row)
        if self.error is not None:
            raise self.error
        return {"id": GENERATED_DEVICE_ID}


@pytest.fixture
def fake_supabase(monkeypatch):
    """Uç noktayı sahte veritabanına bağlar ve kimlik doğrulamasını sabitler."""
    client = FakeSupabase()
    monkeypatch.setattr(endpoints_device, "get_client", lambda: client)
    app.dependency_overrides[auth.require_user] = lambda: auth.UserIdentity(account_id=ACCOUNT_ID)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def client(fake_supabase):
    return TestClient(app)


def create(client, **body):
    """POST /devices — gövde varsayılanı geçerli bir istektir."""
    return client.post("/devices", json={"device_name": "dizustu", **body})


# --- Mutlu yol -------------------------------------------------------------


def test_device_is_created(client):
    """Cihaz oluşturulabilmeli — yoksa hiç kimse sisteme cihaz ekleyemez."""
    response = create(client)
    assert response.status_code == 201


def test_response_carries_the_generated_identifiers(client):
    """Yanıt üç şeyi taşır: sunucunun ürettiği kimlik, ad ve anahtar."""
    body = create(client).json()
    assert body["device_id"] == GENERATED_DEVICE_ID
    assert body["device_name"] == "dizustu"
    assert body["device_key"].startswith(KEY_PREFIX)


def test_device_name_is_trimmed(client, fake_supabase):
    """Baştaki/sondaki boşluk kırpılır — hem yanıtta hem satırda."""
    body = create(client, device_name="  dizustu  ").json()
    assert body["device_name"] == "dizustu"
    assert fake_supabase.rows[0]["device_name"] == "dizustu"


def test_each_device_gets_a_different_key(client):
    """İki cihaz aynı anahtarı alsaydı biri diğerinin verisini yazabilirdi."""
    first = create(client, device_name="bir").json()["device_key"]
    second = create(client, device_name="iki").json()["device_key"]
    assert first != second


# --- Anahtarın saklanması --------------------------------------------------


def test_plain_key_is_never_written_to_the_database(client, fake_supabase):
    """Bu dosyadaki en kritik test.

    Düz anahtar satıra yazılırsa hiçbir şey görünürde bozulmaz: uç 201 döner,
    cihaz bağlanır, testlerin çoğu yeşil kalır. Ama veritabanına erişen herkes
    (yedek dosyası, log, bir SQL enjeksiyonu) tüm cihazların kimliğini ele
    geçirir. `key_hash` tek yönlüdür; düz anahtar değildir.
    """
    key = create(client).json()["device_key"]
    row = fake_supabase.rows[0]

    assert key not in row.values()
    assert row["key_hash"] != key


def test_stored_hash_matches_the_returned_key(client, fake_supabase):
    """Saklanan özet, dönen anahtarın özeti olmalı.

    Aksi halde uç "başarılı" der, kullanıcı anahtarı kurar ve agent
    `require_device` aşamasında hiçbir zaman eşleşme bulamaz.
    """
    key = create(client).json()["device_key"]
    assert fake_supabase.rows[0]["key_hash"] == hash_device_key(key)


def test_row_contains_nothing_beyond_the_three_expected_columns(client, fake_supabase):
    """Satıra fazladan alan sızmamalı — özellikle anahtarın kendisi."""
    create(client)
    assert set(fake_supabase.rows[0]) == {"account_id", "device_name", "key_hash"}


# --- Hesap izolasyonu ------------------------------------------------------


def test_account_id_comes_from_the_token(client, fake_supabase):
    """Satırın sahibi doğrulanmış kullanıcıdır, gövdenin söylediği kişi değil."""
    create(client)
    assert fake_supabase.rows[0]["account_id"] == ACCOUNT_ID


def test_account_id_in_the_body_is_refused(client, fake_supabase):
    """İkinci en kritik test.

    Gövdedeki `account_id` sessizce yok sayılsaydı test yine geçerdi — ama
    davranış "yok sayıldı" mı yoksa "kullanıldı" mı olduğunu dışarıdan ayırt
    edemezdik. `extra="forbid"` sayesinde istek hiç işlenmiyor: niyet
    gürültülü biçimde reddediliyor.
    """
    response = create(client, account_id=OTHER_ACCOUNT_ID)
    assert response.status_code == 422
    assert fake_supabase.rows == []


@pytest.mark.parametrize("field", ["key_hash", "device_id", "id", "logging_enabled", "last_seen"])
def test_server_owned_columns_cannot_be_set_from_the_body(client, fake_supabase, field):
    """Sunucunun doldurduğu hiçbir sütun istemciden gelemez."""
    assert create(client, **{field: "saldirgan"}).status_code == 422
    assert fake_supabase.rows == []


# --- Gövde doğrulama -------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["", "   ", "\t\n", "x" * (MAX_DEVICE_NAME_LENGTH + 1)],
    ids=["bos", "bosluk", "beyaz-bosluk", "cok-uzun"],
)
def test_invalid_device_name_is_rejected(client, fake_supabase, name):
    """Geçersiz ad satır oluşturmadan reddedilir."""
    assert create(client, device_name=name).status_code == 422
    assert fake_supabase.rows == []


def test_missing_device_name_is_rejected(client, fake_supabase):
    """Zorunlu alan eksikse istek işlenmez."""
    assert client.post("/devices", json={}).status_code == 422
    assert fake_supabase.rows == []


def test_longest_allowed_name_is_accepted(client):
    """Sınırın kendisi geçerli olmalı — kontrol bir eksik saymamalı."""
    assert create(client, device_name="x" * MAX_DEVICE_NAME_LENGTH).status_code == 201


# --- Hata yolları ----------------------------------------------------------


def test_duplicate_name_gives_409(monkeypatch, fake_supabase):
    """Aynı hesapta aynı ad iki kez olamaz (unique indeks).

    409 seçilmesi bilinçli: kullanıcının düzeltebileceği KALICI bir durum.
    503 dense istemci tekrar denerdi ve sonuç hiç değişmezdi.
    """
    fake_supabase.error = SupabaseError("çakışma", code=UNIQUE_VIOLATION)
    response = TestClient(app).post("/devices", json={"device_name": "dizustu"})
    assert response.status_code == 409


def test_database_failure_gives_503_not_409(fake_supabase):
    """Geçici arıza kalıcı çakışmadan ayrılmalı — istemci tekrar denemeli."""
    fake_supabase.error = SupabaseError("bağlantı koptu", code="08006")
    response = TestClient(app).post("/devices", json={"device_name": "dizustu"})
    assert response.status_code == 503


def test_database_error_details_are_not_leaked(fake_supabase):
    """Veritabanının kendi mesajı istemciye geçmemeli.

    PostgREST'in `details` alanı sütun adlarını, indeks adlarını ve bazen satır
    değerlerini taşır; bunlar saldırgan için şema haritasıdır.
    """
    secret = "devices_account_id_device_name_idx sütununda çakışma: dizustu"
    fake_supabase.error = SupabaseError(secret, code=UNIQUE_VIOLATION)
    response = TestClient(app).post("/devices", json={"device_name": "dizustu"})

    assert response.status_code == 409
    assert secret not in response.text
    assert "idx" not in response.text


def test_no_key_is_returned_when_creation_fails(fake_supabase):
    """Başarısız istek anahtar sızdırmamalı."""
    fake_supabase.error = SupabaseError("çakışma", code=UNIQUE_VIOLATION)
    response = TestClient(app).post("/devices", json={"device_name": "dizustu"})
    assert KEY_PREFIX not in response.text


# --- Kimlik doğrulama ------------------------------------------------------


def test_endpoint_requires_authentication(monkeypatch):
    """Override YOK: gerçek bağımlılık çalışır ve token'sız istek reddedilir.

    Uç noktanın kendisi bir anahtar fabrikasıdır; kimliksiz erişilebilseydi
    herkes istediği hesaba cihaz açabilirdi.
    """
    client = FakeSupabase()
    monkeypatch.setattr(endpoints_device, "get_client", lambda: client)
    app.dependency_overrides.clear()

    response = TestClient(app).post("/devices", json={"device_name": "dizustu"})

    assert response.status_code == 401
    assert client.rows == []
