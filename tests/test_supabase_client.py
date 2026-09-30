"""collector/supabase_client.py — `devices` satırına yazma yetkisinin sınırı.

Buradaki testler ağa çıkmaz. `update_device` izin kontrolünü HTTP isteğinden
önce yapar, yani reddedilen çağrı hiçbir bağlantı kurmadan hata fırlatır;
istemci de sahte bir adresle kurulur.

Test edilen şey listenin İÇERİĞİ değil, kontrolün VARLIĞIDIR. Listeye sütun
eklemek bilinçli bir karardır ve zaten gözden geçirilir; asıl risk, bir
refactor sırasında kontrolün sessizce düşmesidir.
"""

import asyncio

import pytest

from supabase_client import SupabaseClient

# Cihazın asla kendi kimlik kanıtını yazamaması gereken sütun.
FORBIDDEN_COLUMN = "key_hash"

# İzin listesinde olduğu bilinen, sunucunun damgaladığı sütun.
ALLOWED_COLUMN = "last_seen"


# Kapalı olduğu garanti bir adres. Kontrol düşerse çağrı buraya gider ve
# ANINDA reddedilir; ulaşılamayan bir alan adı seçilseydi test hataya
# düşene kadar timeout süresi boyunca beklerdi.
UNREACHABLE_URL = "http://127.0.0.1:1"


@pytest.fixture
def client():
    """Sahte kimlik bilgileriyle bir istemci — kurulum sırasında bağlantı açılmaz."""
    instance = SupabaseClient(UNREACHABLE_URL, "sahte-service-key")
    yield instance
    asyncio.run(instance.aclose())


def test_forbidden_column_is_rejected(client):
    """İzin listesi dışındaki sütun yazılamaz."""
    with pytest.raises(ValueError):
        asyncio.run(client.update_device("cihaz-1", {FORBIDDEN_COLUMN: "sahte-ozet"}))


def test_rejection_names_the_forbidden_column(client):
    """Hata mesajı hangi sütunun reddedildiğini söylemeli — teşhis buna bağlı."""
    with pytest.raises(ValueError, match=FORBIDDEN_COLUMN):
        asyncio.run(client.update_device("cihaz-1", {FORBIDDEN_COLUMN: "sahte-ozet"}))


def test_mixed_update_is_rejected_as_a_whole(client):
    """İzinli ve izinsiz sütun birlikte gelirse yazma TAMAMEN reddedilir.

    Alternatif davranış — izinsiz sütunu sessizce ayıklayıp gerisini yazmak —
    dışarıdan başarılı görünürdü: istek 200 döner, satır güncellenir, kimse
    reddedilen alandan haberdar olmaz. Kontrolün gürültülü kalması gerekir.
    """
    with pytest.raises(ValueError):
        asyncio.run(
            client.update_device(
                "cihaz-1",
                {ALLOWED_COLUMN: "2026-08-22T00:00:00Z", FORBIDDEN_COLUMN: "sahte-ozet"},
            )
        )


def test_delete_account_targets_the_auth_admin_path_not_rest(client):
    """Hesap silme isteği `/auth/v1/admin/users/...` adresine gider, `/rest/v1/...` altına DEĞİL.

    `httpx` baştaki `/`'lı bir yolu base_url'in sonuna ekler; base_url `/rest/v1`
    ile bittiği için düzeltme olmadan istek `/rest/v1/auth/v1/admin/users/...`
    olurdu — PostgREST'te böyle bir yol yok, 404 döner ve uç sessizce 503'e
    çevrilirdi. Test gerçek adrese çıkmaz: istek sahte bir aktarıcıya düşer.
    """
    import httpx

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    client._client = httpx.AsyncClient(
        base_url=str(client._client.base_url),
        transport=httpx.MockTransport(handler),
    )

    asyncio.run(client.delete_account("hesap-1"))

    assert len(seen) == 1
    assert seen[0].method == "DELETE"
    assert seen[0].url.path == "/auth/v1/admin/users/hesap-1"
