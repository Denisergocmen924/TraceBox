"""
CORS — tarayıcının collector'a doğrudan istek atabilmesi için.

Neden gerekli: collector'ın uçlarından yalnızca **biri** tarayıcıdan çağrılıyor,
`POST /devices` (§9.1 — dashboard cihazı buradan açar, düz anahtar bir kez
burada döner). Diğer üç uç agent'a ait; agent bir tarayıcı değil, CORS onu hiç
ilgilendirmiyor. Bu ayar olmadan dashboard'un "Add Host" düğmesi tarayıcı
tarafından, isteği sunucuya hiç göndermeden bloklanır (§9.13).

**CORS bir güvenlik duvarı DEĞİLDİR** — burada yazan hiçbir şey `curl`'ü ya da
başka bir sunucuyu durdurmaz. Ucu koruyan şey user JWT doğrulaması (`auth.py`).
Buradaki liste yalnızca *tarayıcıya* "şu sayfanın benimle konuşmasına izin
veriyorum" der. Yine de yıldız (`*`) yerine açık liste kullanılıyor: yanlışlıkla
herkese açılmış bir uç, ileride çerez tabanlı bir kimliğe geçilirse sessizce
gerçek bir açığa dönüşür.

`allow_credentials` bilerek **False**: dashboard kimliğini çerezle değil,
elle eklediği `Authorization: Bearer <jwt>` başlığıyla taşıyor. True olsaydı
tarayıcı çerezleri de gönderirdi ve Starlette yıldız kullanımını yasaklardı —
ihtiyaç olmayan bir yetkiyi açık bırakmanın anlamı yok.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("tracebox.cors")

ALLOWED_ORIGINS_ENV = "TRACEBOX_ALLOWED_ORIGINS"

# Env değişkeni tanımlı değilken geçerli olan liste.
#
# localhost'un üretimde de listede kalması zararsız: `Origin` başlığını sayfa
# değil TARAYICI yazar, yani saldırganın sayfası kendi adresini taşımak
# zorundadır — "http://localhost:3000" diye imzalayamaz. Buna karşılık geliştirme
# sırasında kimsenin bir değişken tanımlamak zorunda kalmaması, kurulum
# adımlarından birini tamamen siliyor.
DEFAULT_ORIGINS = ("http://localhost:3000",)

# Yalnızca POST /devices tarayıcıdan çağrılıyor. GET/PUT/DELETE açmanın bir
# karşılığı yok; liste ileride bir uç eklenirse büyür.
ALLOWED_METHODS = ("POST",)

# Dashboard'un gönderdiği iki başlık: kimlik ve gövde tipi. Başka bir başlık
# eklenmesi gerekmiyor — `*` yazmak, ileride eklenecek her başlığı görünmez
# şekilde onaylamak olurdu.
ALLOWED_HEADERS = ("Authorization", "Content-Type")

# Preflight (OPTIONS) yanıtının tarayıcıda saklanma süresi. 10 dakika, "Add
# Host" penceresini üst üste açan bir kullanıcının her seferinde ikinci bir
# gidiş-dönüş ödememesi için yeterli.
PREFLIGHT_CACHE_SECONDS = 600


def parse_origins(raw: str | None) -> list[str]:
    """Virgülle ayrılmış listeyi ayrıştırır.

    Sondaki eğik çizgi kırpılıyor, çünkü tarayıcının gönderdiği `Origin` başlığı
    onu ASLA taşımaz ve Starlette karşılaştırmayı tam metin üzerinden yapar:
    ayarda "https://app.example.com/" yazsaydı hiçbir istek eşleşmez, üstelik
    hata da vermezdi — sessizce çalışmayan bir ayar olurdu.
    """
    if not raw:
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


def install_cors(app: FastAPI) -> None:
    """CORS middleware'ini uygulamaya takar."""
    configured = parse_origins(os.environ.get(ALLOWED_ORIGINS_ENV))
    origins = configured or list(DEFAULT_ORIGINS)

    # Env değişkeni listeyi GENİŞLETMEZ, DEĞİŞTİRİR. Üretimde dashboard'un
    # adresi tanımlandığında localhost kendiliğinden düşsün isteniyor.
    if configured:
        logger.info("CORS origins from %s: %s", ALLOWED_ORIGINS_ENV, ", ".join(origins))
    else:
        logger.warning(
            "%s is not set; only the default origins are allowed: %s",
            ALLOWED_ORIGINS_ENV,
            ", ".join(origins),
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=list(ALLOWED_METHODS),
        allow_headers=list(ALLOWED_HEADERS),
        max_age=PREFLIGHT_CACHE_SECONDS,
    )
