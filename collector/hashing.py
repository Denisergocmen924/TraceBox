"""
Cihaz anahtarı üretme, hash'leme ve karşılaştırma.

Anahtarın düz hali hiçbir yerde saklanmaz: `POST /devices` onu bir kez üretip
yanıtta döndürür, veritabanına yalnızca `devices.key_hash` yazılır.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

# Anahtar ön eki. Doğrulamada kullanılmaz — yalnızca kullanıcının elindeki
# metnin ne olduğunu tanımasına yarar.
KEY_PREFIX = "tbx_live_"

# Anahtarın rastgele bölümünün BAYT uzunluğu. `token_urlsafe` bu baytları
# base64url'e çevirdiği için üretilen metin daha uzundur (32 bayt → 43 karakter).
KEY_ENTROPY_BYTES = 32


def generate_device_key() -> str:
    """Yeni bir cihaz anahtarı üretir: `tbx_live_` ön eki + rastgele son ek.

    Rastgelelik `secrets` modülünden gelir; bu modül işletim sisteminin
    kriptografik rastgelelik kaynağını kullanır. `random` modülü ise başlangıç
    değerinden (seed) türeyen tahmin edilebilir bir dizi üretir ve bir sır
    üretmekte kullanılamaz.
    """
    return f"{KEY_PREFIX}{secrets.token_urlsafe(KEY_ENTROPY_BYTES)}"


def hash_device_key(key: str) -> str:
    """Anahtarın UTF-8 baytlarının SHA-256'sını küçük harf hex olarak döndürür.

    Tanım agent kurulumunda ve `devices.key_hash` satırında birebir aynıdır;
    kayması halinde her istek 401 döner.
    """
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def hashes_match(left: str, right: str) -> bool:
    """İki hash'i sabit sürede (constant-time) karşılaştırır.

    `==` karşılaştırması ilk farklı baytta durur ve süre farkı üzerinden bilgi
    sızdırabilir; `compare_digest` uzunluk aynı olduğu sürece bunu yapmaz.
    """
    return hmac.compare_digest(left, right)
