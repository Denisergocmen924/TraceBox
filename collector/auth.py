"""
Kimlik doğrulama — iki bağımsız mod.

1. **Cihaz anahtarı** (agent → `/inventory`, `/ingest`, `/verify`)
   Cihaz kimliği payload'dan değil ANAHTARDAN türetilir: collector `sha256(key)`
   hesaplar, `devices.key_hash` ile eşleştirir ve satırdan `device_id` +
   `account_id` alır.

2. **User JWT** (dashboard → `/devices`)
   Supabase'in ES256 ile imzaladığı access token, projenin JWKS ucundan çekilen
   AÇIK anahtarla doğrulanır. Token'ın `sub` alanı `auth.uid()`, yani
   `account_id`'dir.

İki mod da `Authorization: Bearer …` başlığını okur ama farklı türde bir sır
bekler; bu yüzden ayrı bağımlılık fonksiyonlarıdır ve bir uç yalnızca birini
kullanır.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Annotated

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWK, PyJWKSet
from jwt.exceptions import PyJWTError

from hashing import hash_device_key, hashes_match
from supabase_client import SupabaseError, get_client, get_project_url

logger = logging.getLogger("tracebox.auth")

BEARER_PREFIX = "Bearer "

# Supabase Auth'un taban yolu. Token'ın `iss` alanı bu adresle biter.
AUTH_PATH = "/auth/v1"

# Açık anahtarların yayınlandığı belge. Bir sır DEĞİLDİR; imzayı doğrulamaya
# yarar, imza atmaya yaramaz.
JWKS_PATH = f"{AUTH_PATH}/.well-known/jwks.json"

# Kabul edilen tek imza algoritması. Liste `jwt.decode`'a verilir ve token'ın
# başlığında başka bir algoritma yazıyorsa doğrulama reddedilir.
ALLOWED_ALGORITHMS = ["ES256"]

# Supabase'in oturum açmış kullanıcı için ürettiği token'da sabit olan iki alan.
EXPECTED_AUDIENCE = "authenticated"
EXPECTED_ROLE = "authenticated"

# Token'da bulunması ZORUNLU alanlar. Eksikse doğrulama başarısız olur; aksi
# halde `exp` taşımayan bir token süresiz geçerli sayılırdı.
REQUIRED_CLAIMS = ["exp", "iss", "aud", "sub"]

# JWKS belgesi çekilirken beklenecek azami süre.
JWKS_TIMEOUT_SECONDS = 10.0

# İki JWKS çekimi arasındaki en kısa süre. Tanınmayan her `kid` anında bir
# çekim tetikleseydi, uydurma `kid`'lerle gönderilen istek seli collector'ı
# Supabase'e istek üretmeye zorlardı; bu sınır o zinciri keser.
JWKS_MIN_REFRESH_SECONDS = 60.0


@dataclass(frozen=True)
class DeviceIdentity:
    """Doğrulanmış cihaz — satırlara bu iki alan sunucu tarafında eklenir."""

    id: str
    account_id: str
    device_name: str
    pending_delete: bool


@dataclass(frozen=True)
class UserIdentity:
    """Doğrulanmış kullanıcı.

    `account_id`, token'ın `sub` alanıdır ve `accounts.id` ile birebir aynıdır
    (şema gereği `accounts.id = auth.users.id`).
    """

    account_id: str


# Tüm başarısız doğrulamalar aynı yanıtı verir: anahtarın/token'ın var olup
# olmadığı, biçiminin doğru olup olmadığı dışarıya sızmaz.
_UNAUTHORIZED_DEVICE = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Geçersiz cihaz anahtarı.",
    headers={"WWW-Authenticate": "Bearer"},
)

_UNAUTHORIZED_USER = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Geçersiz oturum.",
    headers={"WWW-Authenticate": "Bearer"},
)


class _JwksUnavailable(RuntimeError):
    """JWKS belgesi çekilemedi.

    Bu bir yetki sorunu DEĞİLDİR: token geçerli olabilir ama doğrulanamıyordur.
    Çağıran katman bunu 503'e çevirir, 401'e değil.
    """


class _JwksCache:
    """Supabase'in açık anahtarlarını süreç belleğinde tutar.

    Anahtarlar nadiren değişir. Her istekte belgeyi çekmek her doğrulamaya bir
    ağ turu eklerdi; onun yerine belge yalnızca TANINMAYAN bir `kid` görüldüğünde
    yenilenir. Böylece anahtar döndürüldüğünde (rotation) önbellek, ilk isteğin
    gecikmesi pahasına kendiliğinden toparlanır.
    """

    def __init__(self) -> None:
        # kid → açık anahtar.
        self._keys: dict[str, PyJWK] = {}
        # Aynı anda gelen isteklerin aynı yenilemeyi tekrar tekrar yapmaması için.
        self._lock = asyncio.Lock()
        # Son yenileme anı. `monotonic` kullanılır: sistem saati geriye alınsa
        # bile iki olay arasındaki süre doğru ölçülür.
        self._last_refresh: float | None = None

    async def get(self, kid: str) -> PyJWK | None:
        """`kid`e karşılık gelen açık anahtarı döndürür; bulunamazsa None.

        Önbellekte yoksa belge bir kez yenilenir — ama yalnızca son yenilemenin
        üzerinden `JWKS_MIN_REFRESH_SECONDS` geçtiyse. Aksi halde None döner ve
        çağıran token'ı reddeder.
        """
        key = self._keys.get(kid)
        if key is not None:
            return key

        async with self._lock:
            # Kilit beklenirken başka bir istek yenilemiş olabilir; o zaman
            # ikinci bir çekime gerek yok.
            key = self._keys.get(kid)
            if key is not None:
                return key

            if not self._may_refresh():
                return None

            await self._refresh()
            return self._keys.get(kid)

    def _may_refresh(self) -> bool:
        """Yeni bir çekim için yeterli süre geçti mi?"""
        if self._last_refresh is None:
            return True

        return (time.monotonic() - self._last_refresh) >= JWKS_MIN_REFRESH_SECONDS

    async def _refresh(self) -> None:
        """JWKS belgesini çeker ve önbelleği yeni anahtar kümesiyle değiştirir."""
        url = f"{get_project_url()}{JWKS_PATH}"

        # Zaman damgası çekimin SONUCUNDAN önce yazılır: istek başarısız olsa da
        # aralık işlemeye başlasın, yoksa Supabase erişilemez olduğunda gelen
        # her istek yeni bir deneme başlatırdı.
        self._last_refresh = time.monotonic()

        # Kısa ömürlü istemci: bu çekim nadiren olur, kalıcı bir bağlantı
        # havuzunun sağlayacağı kazanç yok.
        try:
            async with httpx.AsyncClient(timeout=JWKS_TIMEOUT_SECONDS) as client:
                response = await client.get(url)
                response.raise_for_status()
                document = response.json()

            key_set = PyJWKSet.from_dict(document)
        except (httpx.HTTPError, ValueError, PyJWTError) as error:
            # Adres loglanır (sır değil), yanıt gövdesi loglanmaz.
            logger.error("JWKS çekilemedi (%s): %r", url, error)
            raise _JwksUnavailable(str(error)) from error

        # `kid` taşımayan anahtar eşleştirmede kullanılamaz, atlanır.
        self._keys = {key.key_id: key for key in key_set.keys if key.key_id}
        logger.info("JWKS yenilendi — %d anahtar", len(self._keys))


# Süreç ömrü boyunca tek örnek. Fly'da birden fazla makine varsa her biri kendi
# önbelleğini tutar; belge zaten herkese açık ve aynıdır.
_jwks = _JwksCache()


def _bearer_token(authorization: str | None, on_failure: HTTPException) -> str:
    """`Authorization: Bearer <değer>` başlığından değeri ayıklar.

    Başlık yoksa, ön ek tutmuyorsa veya değer boşsa `on_failure` fırlatılır.
    """
    if not authorization or not authorization.startswith(BEARER_PREFIX):
        raise on_failure

    token = authorization[len(BEARER_PREFIX) :].strip()
    if not token:
        raise on_failure

    return token


async def require_device(
    authorization: Annotated[str | None, Header()] = None,
) -> DeviceIdentity:
    """`Authorization: Bearer <device_key>` başlığını doğrular.

    Eşleşme yoksa 401. Supabase'e ulaşılamıyorsa 503: bu bir yetki sorunu
    değildir ve agent'ın anahtarını geçersiz sayıp vazgeçmesi istenmez.
    """
    key = _bearer_token(authorization, _UNAUTHORIZED_DEVICE)

    key_hash = hash_device_key(key)
    try:
        row = await get_client().find_device_by_key_hash(key_hash)
    except SupabaseError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Doğrulama şu an yapılamıyor.",
        ) from error

    # Satır sorgusu zaten hash eşitliğiyle yapıldı; karşılaştırma sabit süreli
    # bir ikinci kapı olarak burada tekrarlanır.
    if row is None or not hashes_match(row["key_hash"], key_hash):
        raise _UNAUTHORIZED_DEVICE

    return DeviceIdentity(
        id=row["id"],
        account_id=row["account_id"],
        device_name=row["device_name"],
        pending_delete=row["pending_delete"],
    )


async def require_user(
    authorization: Annotated[str | None, Header()] = None,
) -> UserIdentity:
    """`Authorization: Bearer <supabase_access_token>` başlığını doğrular.

    Sıra: token'ın başlığından `kid` okunur → o `kid`in açık anahtarı bulunur →
    imza, süre (`exp`), hedef (`aud`) ve kaynak (`iss`) doğrulanır → `role`
    alanının `authenticated` olduğu görülür → `sub` account_id olarak döner.

    `kid` başlıktan İMZA DOĞRULANMADAN okunur; bu güvenli çünkü o değer yalnızca
    "hangi anahtarla bakacağız" sorusunu cevaplar. Yanlış veya uydurma bir `kid`,
    doğrulanacak anahtarı bulamadığı için token'ı geçerli kılmaz.
    """
    token = _bearer_token(authorization, _UNAUTHORIZED_USER)

    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except PyJWTError:
        raise _UNAUTHORIZED_USER from None

    if not kid:
        raise _UNAUTHORIZED_USER

    try:
        key = await _jwks.get(kid)
    except _JwksUnavailable as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Doğrulama şu an yapılamıyor.",
        ) from error

    if key is None:
        raise _UNAUTHORIZED_USER

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=ALLOWED_ALGORITHMS,
            audience=EXPECTED_AUDIENCE,
            issuer=f"{get_project_url()}{AUTH_PATH}",
            options={"require": REQUIRED_CLAIMS},
        )
    except PyJWTError as error:
        # Yalnızca hatanın TÜRÜ loglanır — token'ın kendisi bir sırdır ve
        # `fly logs` çıktısına düşmemelidir.
        logger.info("JWT reddedildi: %s", type(error).__name__)
        raise _UNAUTHORIZED_USER from None

    # İmza doğru olsa bile rolü `authenticated` olmayan bir token (örneğin bir
    # servis anahtarı) bir son kullanıcıyı temsil etmez.
    if claims.get("role") != EXPECTED_ROLE:
        logger.info("JWT reddedildi: beklenmeyen role")
        raise _UNAUTHORIZED_USER

    return UserIdentity(account_id=str(claims["sub"]))


# Endpoint imzalarında tekrar etmemek için hazır bağımlılık tipleri.
AuthenticatedDevice = Annotated[DeviceIdentity, Depends(require_device)]
AuthenticatedUser = Annotated[UserIdentity, Depends(require_user)]
