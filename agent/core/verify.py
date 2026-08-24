"""
Bağlantı testi — GET /verify.

İki yerde kullanılır: `install.sh`'in son adımı ve kullanıcının sonradan elle
çalıştırabileceği teşhis komutu (`python -m agent --verify`).

Tek soruyu cevaplar: bu config ile collector'a ulaşılıyor ve anahtar kabul
ediliyor mu? Hiçbir şey yazmaz, hiçbir durum değiştirmez.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

VERIFY_PATH = "/verify"

# Kurulumun sonunda çalıştığı için kısa tutulur: kullanıcı terminalin başında
# bekliyor, dakikalarca asılı kalmamalı.
REQUEST_TIMEOUT_SECONDS = 10.0

# İsteğin hiç yanıt üretemediği durumlar. httpx.InvalidURL ayrıca sayılmak
# zorunda: HTTPError'un ALTINDA değildir, yani elle yazılmış bozuk bir
# collector_url yakalanmadan geçip kullanıcıya traceback gösterirdi.
NETWORK_ERRORS = (httpx.HTTPError, httpx.InvalidURL)


@dataclass(frozen=True)
class VerifyResult:
    """Testin sonucu ve kullanıcıya gösterilecek tek satırlık açıklama."""

    ok: bool
    detail: str


def verify(config) -> VerifyResult:
    """`GET /verify` isteğini atar ve sonucu okunabilir bir mesaja çevirir.

    Durum kodları ayrı ayrı ele alınır çünkü kullanıcının atacağı adım her
    birinde farklıdır: 401 anahtarı, ulaşılamama adresi/ağı, diğer kodlar
    collector'ın kendisini işaret eder.
    """
    url = f"{config.collector_url.rstrip('/')}{VERIFY_PATH}"
    headers = {"Authorization": f"Bearer {config.device_key}"}

    try:
        response = httpx.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    except NETWORK_ERRORS as error:
        return VerifyResult(
            ok=False,
            detail=(
                f"collector'a ulaşılamadı ({type(error).__name__}) — "
                f"collector_url doğru mu, makinenin internet erişimi var mı?"
            ),
        )

    if response.status_code == 200:
        return VerifyResult(ok=True, detail=_describe(response))

    if response.status_code == 401:
        return VerifyResult(
            ok=False,
            detail=(
                "cihaz anahtarı reddedildi (401) — config.toml'daki device_key, "
                "dashboard'un verdiği anahtarla aynı mı?"
            ),
        )

    return VerifyResult(
        ok=False,
        detail=f"collector beklenmeyen yanıt verdi (HTTP {response.status_code})",
    )


def _describe(response: httpx.Response) -> str:
    """200 yanıtından cihaz adı ve collector sürümünü çıkarır.

    Gövde beklenen biçimde değilse test yine BAŞARILI sayılır: doğrulanan şey
    anahtarın kabul edilmesidir, yanıtın şekli değil.
    """
    try:
        body = response.json()
    except ValueError:
        return "bağlantı kuruldu"

    if not isinstance(body, dict):
        return "bağlantı kuruldu"

    device_name = body.get("device_name") or "?"
    version = body.get("version") or "?"
    return f"cihaz: {device_name} · collector sürümü: {version}"
