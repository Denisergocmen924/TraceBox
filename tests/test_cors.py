"""
collector/cors.py — tarayıcıya verilen izin listesi.

Bu ayarın bozulması SESSİZDİR: sunucu ayakta, uç çalışıyor, testler geçiyor ama
dashboard'un "Add Host" düğmesi hiçbir istek göndermeden başarısız oluyor. Hata
yalnızca tarayıcının konsolunda görünür — sunucu loglarında hiçbir iz yok. O
yüzden preflight yanıtı burada doğrudan sınanıyor.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cors import (
    ALLOWED_ORIGINS_ENV,
    DEFAULT_ORIGINS,
    install_cors,
    parse_origins,
)

ALLOWED = "https://dash.example.com"
FOREIGN = "https://evil.example.com"


@pytest.fixture
def client(monkeypatch):
    """CORS'u tek bir origin'e açılmış, boş bir uygulama.

    `main.app` KULLANILMIYOR: o uygulama import anında bir kez kuruluyor, yani
    env değişkeni testte değiştirilse bile geç kalıyor olurdu.
    """
    monkeypatch.setenv(ALLOWED_ORIGINS_ENV, ALLOWED)

    app = FastAPI()
    install_cors(app)

    @app.post("/devices")
    async def _devices() -> dict:
        return {"ok": True}

    return TestClient(app)


# --- parse_origins -------------------------------------------------------


def test_parse_origins_bos_deger_bos_liste():
    assert parse_origins(None) == []
    assert parse_origins("") == []
    assert parse_origins("  ,  ") == []


def test_parse_origins_bosluk_kirpar():
    assert parse_origins(" https://a.com , https://b.com ") == [
        "https://a.com",
        "https://b.com",
    ]


def test_parse_origins_sondaki_egik_cizgiyi_atar():
    """Tarayıcının `Origin` başlığı eğik çizgi taşımaz; ayar taşırsa eşleşmez."""
    assert parse_origins("https://a.com/") == ["https://a.com"]


# --- preflight (OPTIONS) -------------------------------------------------


def test_preflight_izinli_origin_kabul_edilir(client):
    response = client.options(
        "/devices",
        headers={
            "Origin": ALLOWED,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED


def test_preflight_yabanci_origin_reddedilir(client):
    """Reddedilen istek 200 dönebilir; belirleyici olan BAŞLIĞIN YOKLUĞU.

    Tarayıcı `Access-Control-Allow-Origin` görmediği sürece yanıtı sayfaya
    teslim etmez. Durum koduna bakan bir test bu yüzden yanıltıcı olurdu.
    """
    response = client.options(
        "/devices",
        headers={"Origin": FOREIGN, "Access-Control-Request-Method": "POST"},
    )

    assert response.headers.get("access-control-allow-origin") != FOREIGN


def test_gercek_istekte_izin_basligi_dondurulur(client):
    response = client.post("/devices", headers={"Origin": ALLOWED}, json={})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED


def test_yabanci_origin_gercek_istekte_de_isaretlenmez(client):
    response = client.post("/devices", headers={"Origin": FOREIGN}, json={})

    assert response.headers.get("access-control-allow-origin") is None


def test_kimlik_bilgisi_paylasimi_kapali(client):
    """Kimlik `Authorization` başlığıyla taşınıyor, çerezle değil."""
    response = client.post("/devices", headers={"Origin": ALLOWED}, json={})

    assert "access-control-allow-credentials" not in response.headers


def test_yalnizca_post_acik(client):
    """DELETE gibi bir yöntem preflight'tan onay ALMAMALI.

    Starlette bu durumda 400 dönüyor ve gerekçeyi gövdeye yazıyor. Origin
    başlığı yanıtta yine bulunuyor (origin'in kendisi izinli); reddi taşıyan
    şey durum kodu, o yüzden test ona bakıyor.
    """
    response = client.options(
        "/devices",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "DELETE"},
    )

    assert response.status_code == 400
    assert "method" in response.text


def test_izinli_yontemler_yalnizca_post_ilan_eder(client):
    """Preflight yanıtının ilan ettiği liste POST dışına taşmamalı."""
    response = client.options(
        "/devices",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "POST"},
    )

    advertised = {
        method.strip()
        for method in response.headers["access-control-allow-methods"].split(",")
    }
    assert advertised == {"POST"}


# --- varsayılan liste ----------------------------------------------------


def test_env_yoksa_varsayilan_liste_kullanilir(monkeypatch):
    monkeypatch.delenv(ALLOWED_ORIGINS_ENV, raising=False)

    app = FastAPI()
    install_cors(app)

    @app.post("/devices")
    async def _devices() -> dict:
        return {"ok": True}

    local = TestClient(app)
    response = local.post(
        "/devices", headers={"Origin": DEFAULT_ORIGINS[0]}, json={}
    )

    assert response.headers["access-control-allow-origin"] == DEFAULT_ORIGINS[0]


def test_env_varsa_varsayilan_liste_DUSER(monkeypatch):
    """Env listeyi genişletmez, DEĞİŞTİRİR — üretimde localhost açık kalmasın."""
    monkeypatch.setenv(ALLOWED_ORIGINS_ENV, ALLOWED)

    app = FastAPI()
    install_cors(app)

    @app.post("/devices")
    async def _devices() -> dict:
        return {"ok": True}

    local = TestClient(app)
    response = local.post(
        "/devices", headers={"Origin": DEFAULT_ORIGINS[0]}, json={}
    )

    assert response.headers.get("access-control-allow-origin") is None
