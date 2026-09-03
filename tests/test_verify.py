"""
agent/core/verify.py — GET /verify bağlantı testi.

Kurulumun son adımı. Kullanıcının gördüğü tek geri bildirim budur: yanlış
cevap verirse ya çalışmayan bir kuruluma "tamam" der ya da çalışan bir kuruluma
"olmadı" deyip kullanıcıyı config'i bozmaya iter.

Ağa çıkılmıyor: `httpx.get` sahte bir fonksiyonla değiştiriliyor.
"""

from __future__ import annotations

import httpx
import pytest

from agent.core import verify as verify_module
from agent.core.config import Config
from agent.core.verify import REQUEST_TIMEOUT_SECONDS, verify

COLLECTOR_URL = "https://collector.example"
DEVICE_KEY = "tbx_live_cok_gizli_anahtar"


def make_config(collector_url: str = COLLECTOR_URL) -> Config:
    return Config(collector_url=collector_url, device_key=DEVICE_KEY)


class Recorder:
    """`httpx.get` yerine geçer; çağrıyı kaydeder ve hazır yanıtı döndürür."""

    def __init__(self, response: httpx.Response | Exception) -> None:
        self.response = response
        self.calls: list[dict] = []

    def __call__(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def respond(status_code: int, *, json=None, text=None) -> httpx.Response:
    request = httpx.Request("GET", f"{COLLECTOR_URL}/verify")
    if json is not None:
        return httpx.Response(status_code, json=json, request=request)
    return httpx.Response(status_code, text=text or "", request=request)


@pytest.fixture
def transport(monkeypatch):
    """Testin kurduğu yanıtı `verify()`ye bağlar."""

    def install(response):
        recorder = Recorder(response)
        monkeypatch.setattr(verify_module.httpx, "get", recorder)
        return recorder

    return install


# --- İstek nasıl kuruluyor -------------------------------------------------


def test_request_goes_to_the_verify_path(transport):
    """Adres collector_url + /verify olmalı."""
    recorder = transport(respond(200, json={}))
    verify(make_config())
    assert recorder.calls[0]["url"] == f"{COLLECTOR_URL}/verify"


def test_trailing_slash_does_not_double_up(transport):
    """Kullanıcı adresi `.../` diye yazarsa `//verify` oluşmamalı.

    Çoğu sunucu bunu bağışlar ama bağışlamayan biri 404 döndürür ve kullanıcı
    hatayı anahtarında arar.
    """
    recorder = transport(respond(200, json={}))
    verify(make_config(f"{COLLECTOR_URL}/"))
    assert recorder.calls[0]["url"] == f"{COLLECTOR_URL}/verify"


def test_key_is_sent_as_a_bearer_token(transport):
    """Anahtar `Authorization: Bearer …` başlığında gider."""
    recorder = transport(respond(200, json={}))
    verify(make_config())
    assert recorder.calls[0]["headers"]["Authorization"] == f"Bearer {DEVICE_KEY}"


def test_key_is_not_put_in_the_url(transport):
    """Bu dosyadaki en kritik testlerden biri.

    Anahtar sorgu dizesine kaysaydı test yine geçerdi — collector başlığa da
    bakabilir. Ama URL'ler sunucu erişim loglarına, proxy kayıtlarına ve
    tarayıcı geçmişine düz metin yazılır; başlık yazılmaz.
    """
    recorder = transport(respond(200, json={}))
    verify(make_config())
    assert DEVICE_KEY not in recorder.calls[0]["url"]


def test_request_has_a_timeout(transport):
    """Zaman aşımı olmadan kurulum, cevap vermeyen bir sunucuda süresiz asılırdı."""
    recorder = transport(respond(200, json={}))
    verify(make_config())
    assert recorder.calls[0]["timeout"] == REQUEST_TIMEOUT_SECONDS


# --- Başarı ----------------------------------------------------------------


def test_200_is_success(transport):
    """Anahtar kabul edildiyse kurulum başarılı sayılır."""
    transport(respond(200, json={}))
    assert verify(make_config()).ok is True


def test_success_reports_the_device_name_and_version(transport):
    """Kullanıcı doğru cihaza bağlandığını görebilmeli."""
    transport(respond(200, json={"device_name": "dizustu", "version": "0.3.0"}))
    detail = verify(make_config()).detail
    assert "dizustu" in detail
    assert "0.3.0" in detail


@pytest.mark.parametrize(
    "response",
    [respond(200, text="merhaba"), respond(200, json=["liste"]), respond(200, json={})],
    ids=["json-degil", "sozluk-degil", "bos-sozluk"],
)
def test_unexpected_body_does_not_fail_the_check(transport, response):
    """Doğrulanan şey anahtarın kabulü, yanıtın şekli değil.

    Gövde beklenmedik geldiğinde `ok=False` dönseydi, çalışan bir kurulum
    "bağlanamadı" derdi ve kullanıcı sorunsuz config'ini bozmaya çalışırdı.
    """
    transport(response)
    assert verify(make_config()).ok is True


# --- Başarısızlık ----------------------------------------------------------


def test_401_is_a_failure_about_the_key(transport):
    """Reddedilen anahtar, kullanıcıyı doğrudan device_key'e yönlendirmeli."""
    transport(respond(401, json={"detail": "Invalid device key."}))
    result = verify(make_config())
    assert result.ok is False
    assert "device_key" in result.detail


@pytest.mark.parametrize("status_code", [204, 301, 400, 403, 404, 500, 503])
def test_only_200_counts_as_connected(transport, status_code):
    """En kritik test.

    "2xx ise tamam" ya da "401 değilse tamam" gibi gevşek bir kontrol sessizce
    yanlış olurdu: 404 (yanlış adres) ya da 503 (collector ayakta değil) alan
    kullanıcı "✓ Kuruldu ve bağlandı" görür, sorunun ortaya çıkması ilk verinin
    kaybolmasına kadar gecikirdi.
    """
    transport(respond(status_code, json={}))
    assert verify(make_config()).ok is False


def test_unexpected_status_is_reported_with_its_code(transport):
    """Teşhis için kodun kendisi mesajda görünmeli."""
    transport(respond(502, json={}))
    assert "502" in verify(make_config()).detail


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("bağlanılamadı"),
        httpx.ConnectTimeout("zaman aşımı"),
        httpx.ReadTimeout("okuma zaman aşımı"),
        httpx.InvalidURL("geçersiz adres"),
    ],
    ids=["baglanti", "baglanti-zaman-asimi", "okuma-zaman-asimi", "gecersiz-adres"],
)
def test_network_errors_become_a_readable_failure(transport, error):
    """Ağ hatası istisna olarak dışarı sızmamalı.

    Sızsaydı `python -m agent --verify` bir Python traceback'i basardı ve
    install.sh'in son adımı kullanıcıya hiçbir şey anlatmazdı.
    """
    transport(error)
    result = verify(make_config())
    assert result.ok is False
    assert "collector_url" in result.detail


# --- Sızıntı ---------------------------------------------------------------


@pytest.mark.parametrize(
    "response",
    [
        respond(200, json={"device_name": "dizustu", "version": "0.3.0"}),
        respond(401, json={}),
        respond(500, json={}),
        httpx.ConnectError("bağlanılamadı"),
    ],
    ids=["basarili", "reddedildi", "sunucu-hatasi", "ag-hatasi"],
)
def test_key_never_appears_in_the_result(transport, response):
    """Mesaj ekrana basılır ve kullanıcı onu kopyalayıp paylaşır.

    Anahtar mesaja karışsaydı (örneğin "anahtar X reddedildi" gibi yardımsever
    bir metinle) sır, destek talebiyle birlikte dışarı çıkardı.
    """
    transport(response)
    assert DEVICE_KEY not in verify(make_config()).detail
