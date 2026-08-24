"""
collector/auth.py — `require_user`: dashboard'un Supabase access token'ı.

Bu uç (`POST /devices`) cihaz oluşturur ve anahtar üretir. Doğrulama gevşerse
saldırgan başkasının hesabına cihaz açabilir; `account_id` gövdeden değil
buradan geldiği için tüm izolasyon bu fonksiyona dayanır.

Testler AĞA ÇIKMAZ ama gerçek kripto kullanır: yerel bir ES256 anahtar çifti
üretilir, açık anahtar 127.0.0.1'de çalışan küçük bir sunucudan JWKS olarak
servis edilir. Böylece imza doğrulaması, JWKS çekimi ve önbellek gerçekten
çalışır — sahte bir doğrulayıcı değil.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from jwt.algorithms import ECAlgorithm

import auth

# Supabase'in token'a koyduğu sabitler.
ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"
VALID_KID = "gecerli-anahtar"

# JWKS'te KARŞILIĞI OLMAYAN bir kid — önbelleğin bilmediği anahtar.
UNKNOWN_KID = "bilinmeyen-anahtar"

# Kapalı olduğu garanti adres: JWKS çekilemediğinde ne olduğunu sınamak için.
# Ulaşılamayan bir alan adı seçilseydi test timeout boyunca beklerdi.
UNREACHABLE_URL = "http://127.0.0.1:1"


# --- Anahtarlar ------------------------------------------------------------
# İki çift üretilir: biri gerçek imzalayan, diğeri "doğru kid'i taşıyan ama
# yanlış anahtarla imzalanmış" token'ı kurmak için.

SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())
ROGUE_KEY = ec.generate_private_key(ec.SECP256R1())


def _jwks_document() -> dict:
    """Sunucunun servis edeceği JWKS belgesi — yalnızca GEÇERLİ anahtarı içerir."""
    key = json.loads(ECAlgorithm.to_jwk(SIGNING_KEY.public_key()))
    key.update({"kid": VALID_KID, "use": "sig", "alg": "ES256"})
    return {"keys": [key]}


# --- Sahte Supabase JWKS sunucusu ------------------------------------------


class _JwksServer:
    """JWKS belgesini servis eden ve KAÇ KEZ istendiğini sayan mini sunucu."""

    def __init__(self) -> None:
        self.request_count = 0
        document = json.dumps(_jwks_document()).encode()
        server_self = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                server_self.request_count += 1
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(document)))
                self.end_headers()
                self.wfile.write(document)

            def log_message(self, *args):
                """Test çıktısını kirletmesin."""

        self._httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self._httpd.server_address[1]}"
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()

    def shutdown(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


@pytest.fixture(scope="module")
def jwks_server():
    server = _JwksServer()
    yield server
    server.shutdown()


@pytest.fixture
def project_url(jwks_server, monkeypatch):
    """Collector'a Supabase adresi olarak sahte sunucuyu gösterir.

    Önbellek de sıfırlanır: modül düzeyinde tek bir örnek olduğu için bir
    testin çektiği anahtar diğerine sızardı ve çekim sayısını sayan testler
    birbirine bağımlı hale gelirdi.
    """
    monkeypatch.setattr(auth, "get_project_url", lambda: jwks_server.base_url)
    monkeypatch.setattr(auth, "_jwks", auth._JwksCache())
    jwks_server.request_count = 0
    return jwks_server.base_url


def make_token(project: str, *, key=None, kid: str = VALID_KID, algorithm: str = "ES256", **overrides) -> str:
    """Geçerli bir Supabase token'ı üretir; `overrides` ile tek alan bozulur.

    `None` verilen alan claim'lerden TAMAMEN çıkarılır — "eksik alan"
    senaryolarını kurmak için.
    """
    claims = {
        "sub": ACCOUNT_ID,
        "aud": auth.EXPECTED_AUDIENCE,
        "iss": f"{project}{auth.AUTH_PATH}",
        "role": auth.EXPECTED_ROLE,
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    claims = {name: value for name, value in claims.items() if value is not None}

    headers = {"kid": kid} if kid is not None else {}
    return jwt.encode(claims, key or SIGNING_KEY, algorithm=algorithm, headers=headers)


def authorize(token: str) -> auth.UserIdentity:
    """`require_user`'ı doğrudan çağırır (uç noktadan geçmeden)."""
    return asyncio.run(auth.require_user(authorization=f"Bearer {token}"))


def status_of(token_or_header: str, *, raw: bool = False) -> int:
    """Reddedilen bir isteğin HTTP durum kodunu döndürür."""
    header = token_or_header if raw else f"Bearer {token_or_header}"
    with pytest.raises(HTTPException) as info:
        asyncio.run(auth.require_user(authorization=header))
    return info.value.status_code



# --- Elle kurulmuş saldırı token'ları --------------------------------------
# PyJWT bu iki token'ı ÜRETMEYİ reddeder (imzasız token yazmaz, açık anahtarı
# HMAC sırrı olarak kabul etmez). Saldırganın böyle bir kısıtı yok; o yüzden
# token'lar burada baytlarından kuruluyor.

PUBLIC_KEY_PEM = SIGNING_KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
)


def _segment(data: dict) -> bytes:
    """JWT parçası: JSON → base64url (dolgu karakterleri atılmış)."""
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=")


def _attack_claims(project: str) -> dict:
    """Geçerli bir token'ın taşıyacağı alanların aynısı — fark yalnızca imzada."""
    return {
        "sub": ACCOUNT_ID,
        "aud": auth.EXPECTED_AUDIENCE,
        "iss": f"{project}{auth.AUTH_PATH}",
        "role": auth.EXPECTED_ROLE,
        "exp": int(time.time()) + 3600,
    }


def craft_unsigned_token(project: str) -> str:
    """`alg: none` başlıklı, imza bölümü BOŞ token."""
    header = _segment({"alg": "none", "typ": "JWT", "kid": VALID_KID})
    return (header + b"." + _segment(_attack_claims(project)) + b".").decode()


def craft_hmac_token(project: str) -> str:
    """Açık anahtarı HMAC sırrı gibi kullanarak imzalanmış token."""
    header = _segment({"alg": "HS256", "typ": "JWT", "kid": VALID_KID})
    signing_input = header + b"." + _segment(_attack_claims(project))
    signature = hmac.new(PUBLIC_KEY_PEM, signing_input, hashlib.sha256).digest()
    return (signing_input + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode()


# --- Kabul -----------------------------------------------------------------


def test_valid_token_is_accepted(project_url):
    """Geçerli token geçmeli — yoksa hiçbir kullanıcı cihaz ekleyemez."""
    identity = authorize(make_token(project_url))
    assert identity.account_id == ACCOUNT_ID


def test_account_id_comes_from_the_sub_claim(project_url):
    """Hesap kimliği token'ın `sub` alanıdır; şemada `accounts.id` ile aynıdır.

    Başka bir alandan (ya da sabit bir değerden) okunsaydı tüm cihazlar tek
    hesaba düşerdi ve kullanıcı izolasyonu diye bir şey kalmazdı.
    """
    other = "22222222-2222-2222-2222-222222222222"
    assert authorize(make_token(project_url, sub=other)).account_id == other


# --- Başlık biçimi ---------------------------------------------------------


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "Basic abc",
        "bearer-token",
        "Bearer",
        "Bearer ",
        "Bearer    ",
    ],
    ids=["yok", "bos", "basic", "onek-yok", "deger-yok", "bosluk", "sadece-bosluk"],
)
def test_malformed_authorization_header_is_rejected(project_url, header):
    """Beklenen biçimde olmayan başlık hiç ayrıştırılmadan reddedilir."""
    with pytest.raises(HTTPException) as info:
        asyncio.run(auth.require_user(authorization=header))
    assert info.value.status_code == 401


def test_garbage_token_is_rejected(project_url):
    """JWT olmayan bir metin çözümlenemeden reddedilmeli (çökmemeli)."""
    assert status_of("bu-bir-jwt-degil") == 401


# --- İmza ------------------------------------------------------------------


def test_token_signed_by_another_key_is_rejected(project_url):
    """Bu dosyadaki en kritik test.

    Token'ın kid'i doğru, biçimi kusursuz, tüm alanları yerinde — yalnızca
    imza başka bir anahtarla atılmış. İmza doğrulaması atlanırsa bu token
    kabul edilir ve saldırgan İSTEDİĞİ `sub` değerini yazarak herhangi bir
    hesabın adına cihaz açabilir. Dışarıdan hiçbir şey bozulmuş görünmez.
    """
    assert status_of(make_token(project_url, key=ROGUE_KEY)) == 401


def test_configuration_allows_only_es256(project_url):
    """Algoritma izin listesi tek elemanlı kalmalı.

    Bu doğrudan bir sözleşme iddiası, davranış testi değil — ve bilerek öyle.
    Aşağıdaki iki saldırı testi, liste genişletilse BİLE reddedilir: JWKS'ten
    gelen anahtar `alg: ES256` etiketi taşır ve PyJWT, token'ın algoritması
    anahtarınkiyle uyuşmazsa doğrulamayı reddeder. Yani savunma iki katmanlı
    ve listeyi genişletmek tek başına açığa yol açmıyor.

    Bu da o testleri liste değişikliğine KÖR bırakıyor. Listenin kendisini
    burada sabitlemek, bekçisiz kalacak tek noktayı kapatır.
    """
    assert auth.ALLOWED_ALGORITHMS == ["ES256"]


def test_unsigned_token_is_rejected(project_url):
    """`alg: none` — imzasız token.

    JWT kütüphanelerinin klasik açığı: token "imzam yok" der ve doğrulayıcı
    bunu kabul eder. Token elle kuruluyor; PyJWT böyle bir token'ı üretmeyi
    reddettiği için `jwt.encode` ile hazırlanamaz.
    """
    assert status_of(craft_unsigned_token(project_url)) == 401


def test_forged_hmac_token_is_rejected(project_url):
    """Algoritma karışıklığı (algorithm confusion) saldırısı.

    Doğrulama anahtarı HERKESE AÇIKTIR. Saldırgan onu bir HMAC sırrı gibi
    kullanıp kendi token'ını imzalar; doğrulayıcı "aynı anahtar" gördüğü için
    imzayı geçerli sayabilir. Sahte token gerçek açık anahtarla imzalanıyor,
    yani saldırının birebir kendisi.
    """
    assert status_of(craft_hmac_token(project_url)) == 401


# --- Alanlar ---------------------------------------------------------------


def test_expired_token_is_rejected(project_url):
    """Süresi dolmuş oturum kabul edilmemeli."""
    assert status_of(make_token(project_url, exp=int(time.time()) - 1)) == 401


def test_token_without_expiry_is_rejected(project_url):
    """`exp` yoksa token SÜRESİZ geçerli olurdu — sızan bir token hiç ölmezdi."""
    assert status_of(make_token(project_url, exp=None)) == 401


def test_token_without_subject_is_rejected(project_url):
    """`sub` yoksa `account_id` yoktur; satır sahipsiz yazılırdı."""
    assert status_of(make_token(project_url, sub=None)) == 401


def test_token_for_another_audience_is_rejected(project_url):
    """Başka bir uygulama için üretilmiş token bu servise girmemeli."""
    assert status_of(make_token(project_url, aud="baska-uygulama")) == 401


def test_token_from_another_issuer_is_rejected(project_url):
    """Başka bir Supabase projesinin token'ı kabul edilmemeli.

    İmza kendi projesinde geçerlidir; `iss` kontrolü olmasaydı yalnızca aynı
    kid'i taşıması yeterdi.
    """
    assert status_of(make_token(project_url, iss="https://baska-proje.supabase.co/auth/v1")) == 401


@pytest.mark.parametrize("role", ["anon", "service_role", "", None], ids=["anon", "service", "bos", "yok"])
def test_token_without_authenticated_role_is_rejected(project_url, role):
    """İmzası doğru olsa da son kullanıcıyı temsil etmeyen token reddedilir.

    `service_role` özellikle önemli: o token RLS'i tamamen bypass eder ve bir
    son kullanıcıya ait değildir.
    """
    assert status_of(make_token(project_url, role=role)) == 401


# --- kid ve JWKS -----------------------------------------------------------


def test_token_without_kid_is_rejected(project_url):
    """`kid` yoksa hangi anahtarla doğrulanacağı bilinemez."""
    assert status_of(make_token(project_url, kid=None)) == 401


def test_unknown_kid_is_rejected(project_url):
    """JWKS'te karşılığı olmayan kid — imza doğrulanamaz."""
    assert status_of(make_token(project_url, kid=UNKNOWN_KID)) == 401


def test_jwks_is_fetched_once_and_cached(project_url, jwks_server):
    """Açık anahtarlar nadiren değişir; her doğrulama bir ağ turu ödememeli."""
    for _ in range(5):
        authorize(make_token(project_url))

    assert jwks_server.request_count == 1


def test_unknown_kid_flood_does_not_amplify_into_supabase(project_url, jwks_server):
    """Servis dışı bırakma (DoS) yükseltmesine karşı fren.

    Tanınmayan her kid anında bir JWKS çekimi tetikleseydi, saldırgan uydurma
    kid'lerle collector'ı Supabase'e istek üretmeye zorlardı: kendi
    altyapımızı kendi sağlayıcımıza saldırtan bir kaldıraç. Aralık sınırı
    (JWKS_MIN_REFRESH_SECONDS) o zinciri keser.
    """
    for index in range(20):
        assert status_of(make_token(project_url, kid=f"uydurma-{index}")) == 401

    assert jwks_server.request_count <= 1


def test_unavailable_jwks_gives_503_not_401(monkeypatch):
    """Doğrulanamamak ile reddedilmek aynı şey değildir.

    401 dönseydi dashboard kullanıcıya "oturumunuz geçersiz" derdi ve kullanıcı
    aslında sağlam olan oturumunu kapatıp tekrar giriş yapmaya çalışırdı. 503
    "şu an bakamıyorum, tekrar dene" demektir.
    """
    monkeypatch.setattr(auth, "get_project_url", lambda: UNREACHABLE_URL)
    monkeypatch.setattr(auth, "_jwks", auth._JwksCache())

    token = make_token(UNREACHABLE_URL)
    with pytest.raises(HTTPException) as info:
        asyncio.run(auth.require_user(authorization=f"Bearer {token}"))

    assert info.value.status_code == 503


# --- Sızıntı ---------------------------------------------------------------


def test_rejection_does_not_leak_the_token(project_url, caplog):
    """Token bir SIRDIR: `fly logs` çıktısına düşerse oturum çalınabilir.

    Reddedilen istekleri loglamak teşhis için gerekli; loglanan şeyin hatanın
    TÜRÜ olması, token'ın kendisi olmaması gerekiyor.
    """
    token = make_token(project_url, key=ROGUE_KEY)

    with caplog.at_level("DEBUG", logger="tracebox.auth"):
        assert status_of(token) == 401

    assert token not in caplog.text


def test_rejection_message_is_the_same_for_every_failure(project_url):
    """Hata mesajı "neden" olduğunu söylememeli.

    Farklı sebepler farklı mesaj verseydi saldırgan yanıtlara bakarak
    ilerleyebilirdi: "kid doğru ama imza yanlış" ile "kid yok" arasındaki fark
    bir ipucudur.
    """
    reasons = [
        make_token(project_url, key=ROGUE_KEY),
        make_token(project_url, exp=int(time.time()) - 1),
        make_token(project_url, aud="baska"),
        make_token(project_url, role="anon"),
        make_token(project_url, kid=UNKNOWN_KID),
        "bu-bir-jwt-degil",
    ]

    details = set()
    for token in reasons:
        with pytest.raises(HTTPException) as info:
            asyncio.run(auth.require_user(authorization=f"Bearer {token}"))
        details.add(info.value.detail)

    assert len(details) == 1
