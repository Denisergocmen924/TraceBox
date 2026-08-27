"""
POST /inventory — dış IP'yi cihaz DEĞİL, isteği alan taraf yazar.

Bu, `device_id`de verilen kararın ikinci uygulaması: cihazın kendisi hakkında
söylediği hiçbir şey doğruluk kaynağı değildir. `device_id` anahtardan
türetiliyor; `external_ip` de bağlantının kendisinden türetilir. Agent
gönderseydi, istediği adresi yazabilirdi — dashboard'da "bu makine nereden
bağlanıyor" sorusunun cevabı cihazın beyanı olurdu.

İkinci mesele RIZA: alan bir eklentidir. Kullanıcı kapattığında yalnızca yeni
yazma durmaz, daha önce kaydedilmiş adres de silinir.

Supabase taklit ediliyor, cihaz doğrulaması bağımlılık override'ıyla
sabitleniyor — anahtarın kendisi test_collector_security.py'de sınanıyor.
"""

from __future__ import annotations

from dataclasses import fields as dataclass_fields

import pytest
from fastapi.testclient import TestClient

import auth
import endpoints_commands
import endpoints_ingest
from agent.core.config import ADDON_EXTERNAL_IP
from agent.core.inventory import Inventory
from endpoints_ingest import EXTERNAL_IP_ADDON, InventoryIn
from main import app
from supabase_client import DEVICE_WRITABLE_COLUMNS

DEVICE_ID = "33333333-3333-3333-3333-333333333333"
ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"

CLIENT_IP = "203.0.113.7"
HEADER = {"Fly-Client-IP": CLIENT_IP}


class FakeSupabase:
    """Yalnızca cihaz satırına yazmayı kaydeden sahte istemci."""

    def __init__(self) -> None:
        self.updates: list[dict] = []
        self.inserted: list[tuple[str, list[dict]]] = []

    async def update_device(self, device_id: str, fields: dict) -> None:
        self.updates.append(fields)

    async def insert_rows(self, table: str, rows: list[dict]) -> None:
        self.inserted.append((table, rows))

    async def list_pending_commands(self, device_id: str) -> list[dict]:
        return []


@pytest.fixture
def fake_supabase(monkeypatch):
    client = FakeSupabase()
    monkeypatch.setattr(endpoints_ingest, "get_client", lambda: client)
    monkeypatch.setattr(endpoints_commands, "get_client", lambda: client)
    app.dependency_overrides[auth.require_device] = lambda: auth.DeviceIdentity(
        id=DEVICE_ID, account_id=ACCOUNT_ID, device_name="dizustu"
    )
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def client(fake_supabase):
    return TestClient(app)


def send(client, *, addons=(ADDON_EXTERNAL_IP,), headers=HEADER, **body):
    """POST /inventory — gövde varsayılanı yalnızca eklenti listesini taşır."""
    return client.post(
        "/inventory",
        json={"enabled_addons": list(addons), **body},
        headers=headers,
    )


def written(fake_supabase) -> dict:
    """Cihaz satırına yazılan alanlar."""
    assert fake_supabase.updates, "update_device hiç çağrılmadı"
    return fake_supabase.updates[-1]


# --- adresin kaynağı --------------------------------------------------------


def test_the_proxy_header_is_written_to_the_device_row(client, fake_supabase):
    """Eklenti açıkken adres başlıktan okunup satıra yazılır."""
    assert send(client).status_code == 200

    assert written(fake_supabase)["external_ip"] == CLIENT_IP


def test_the_body_may_not_carry_an_external_ip(client, fake_supabase):
    """Agent adresi göndermeye çalışırsa istek REDDEDİLİR, yok sayılmaz.

    422, sözleşmenin sessizce esnemediğini gösterir: alan yok sayılsaydı
    gönderen taraf gönderdiğini sanmaya devam ederdi.
    """
    response = send(client, external_ip="198.51.100.9")

    assert response.status_code == 422
    assert fake_supabase.updates == [], "reddedilen istek yine de satıra dokundu"


def test_the_forwarded_for_header_is_not_a_source(client, fake_supabase):
    """X-Forwarded-For adresin kaynağı değildir.

    O başlık bir LİSTEDİR ve istemci listenin başına istediğini ekleyebilir;
    kaynak olarak kullanmak, reddedilen "gövdede gönder" yolunu başka bir adla
    geri açmak olurdu.
    """
    send(client, headers={"X-Forwarded-For": "198.51.100.9"})

    assert written(fake_supabase)["external_ip"] is None


def test_a_missing_header_leaves_the_column_null(client, fake_supabase):
    """Proxy başlığı yoksa (yerel çalıştırma) sütun null kalır.

    Soketin karşı ucuna düşülmez: proxy arkasında o adres proxy'nin kendisidir
    ve cihazın adresi diye kaydedilmesi, boş bırakmaktan daha kötüdür.
    """
    send(client, headers={})

    assert written(fake_supabase)["external_ip"] is None


def test_a_malformed_header_is_not_stored(client, fake_supabase):
    """IP olarak çözülemeyen değer sütuna OLDUĞU GİBİ yazılmaz."""
    send(client, headers={"Fly-Client-IP": "<script>203.0.113.7"})

    assert written(fake_supabase)["external_ip"] is None


def test_an_ipv6_address_is_stored_in_its_canonical_form(client, fake_supabase):
    """Aynı adres tek bir yazımla kaydedilir.

    IPv6 aynı adresi birçok şekilde yazabilir; normalleştirilmezse dashboard'da
    "adres değişti" gibi görünen bir fark oluşurdu.
    """
    send(client, headers={"Fly-Client-IP": "2001:0DB8:0000:0000:0000:0000:0000:0001"})

    assert written(fake_supabase)["external_ip"] == "2001:db8::1"


# --- rıza -------------------------------------------------------------------


def test_a_disabled_addon_clears_the_previously_stored_address(client, fake_supabase):
    """Eklenti kapalıyken sütuna açıkça null YAZILIR.

    "Yazmamak" yetmezdi: daha önce kaydedilmiş adres satırda kalırdı. Kullanıcı
    eklentiyi kapattığında enabled_addons değiştiği için envanter zaten yeniden
    gönderilir; o gönderim eski değeri siler.
    """
    send(client, addons=())

    fields = written(fake_supabase)
    assert "external_ip" in fields, "alan hiç yazılmadı — eski adres satırda kalır"
    assert fields["external_ip"] is None


def test_consent_is_read_from_the_request_not_assumed(client, fake_supabase):
    """Aynı bağlantı, aynı başlık, farklı rıza — sonuç farklı olmalı."""
    send(client, addons=())
    without = written(fake_supabase)["external_ip"]

    send(client)
    with_consent = written(fake_supabase)["external_ip"]

    assert (without, with_consent) == (None, CLIENT_IP)


def test_ingest_never_writes_the_address(client, fake_supabase):
    """POST /ingest adrese dokunmaz.

    Bu bir kapsam kararından fazlası: /ingest gövdesinde `enabled_addons` YOK.
    Oradan yazılan bir adres, rızayı hiç okumadan yazılmış olurdu. Adresi daha
    sık tazelemek istenirse önce rızanın cihaz satırından okunması gerekir —
    bu test o adımın atlanmasını engeller.
    """
    client.post("/ingest", json={}, headers=HEADER)

    assert "external_ip" not in written(fake_supabase)


# --- sözleşme ---------------------------------------------------------------


def test_the_addon_name_is_the_same_on_both_sides(client):
    """Eklenti adı iki tarafta ayrı tanımlı; ayrışırlarsa rıza sessizce kaybolur.

    Collector agent'tan import ETMEZ (ayrı deploy edilen ayrı programlar);
    paylaştıkları şey wire sözleşmesidir. Ayrışma hata üretmez — collector
    kullanıcının açtığı eklentiyi kapalı sanar ve sütun sonsuza kadar null
    kalır.
    """
    assert EXTERNAL_IP_ADDON == ADDON_EXTERNAL_IP


def test_the_inventory_contract_matches_field_for_field():
    """Agent'ın Inventory'si ile collector'ın InventoryIn'i AYNI alanları taşır.

    Fazla alan `extra="forbid"` yüzünden 422 üretir (envanter hiç yazılmaz);
    eksik alan sessizce null kalır. İkisi de tek bir listenin bir tarafta
    güncellenip diğerinde unutulmasıyla oluşur.
    """
    agent_fields = {field.name for field in dataclass_fields(Inventory)}

    assert agent_fields == set(InventoryIn.model_fields)


def test_every_column_the_endpoint_writes_is_permitted(client, fake_supabase):
    """Uç noktanın yazdığı her sütun DEVICE_WRITABLE_COLUMNS içinde olmalı.

    Service key RLS'i bypass ediyor; bu küme, Postgres'e ulaşmadan önceki son
    kapı. external_ip'in oraya eklenmesi (agent gönderemese de collector
    yazabilmeli) o kapıyı açık bırakmamalı.
    """
    send(client)

    assert set(written(fake_supabase)) <= DEVICE_WRITABLE_COLUMNS
