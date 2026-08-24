"""collector/hashing.py — cihaz anahtarının üretilmesi, özetlenmesi ve karşılaştırılması."""

import random

from hashing import KEY_PREFIX, generate_device_key, hash_device_key, hashes_match


def test_hash_does_not_return_plain_key():
    """Özet anahtarın kendisi olamaz: veritabanında düz anahtar durmaz."""
    key = "tbx_live_ornek"
    assert hash_device_key(key) != key


def test_same_key_gives_same_hash():
    """Doğrulama buna dayanır: aynı anahtar her seferinde aynı özeti üretmeli."""
    assert hash_device_key("tbx_live_a") == hash_device_key("tbx_live_a")


def test_different_keys_give_different_hashes():
    """Farklı cihazlar farklı satırlara düşmeli."""
    assert hash_device_key("tbx_live_a") != hash_device_key("tbx_live_b")


def test_matching_hashes_are_accepted():
    """Doğru anahtar içeri girebilmeli — yoksa hiçbir cihaz bağlanamaz."""
    digest = hash_device_key("tbx_live_a")
    assert hashes_match(digest, digest) is True


def test_different_hashes_are_rejected():
    """Bu dosyadaki en kritik iddia.

    Karşılaştırma her koşulda True dönseydi hiçbir şey görünürde bozulmazdı:
    cihazlar çalışmaya devam eder, log temiz kalır, sağlık kontrolü yeşil
    yanar — ve rastgele bir anahtarla herkes içeri girerdi. Sessiz bir açık
    olduğu için tek bekçisi bu testtir.
    """
    assert hashes_match(hash_device_key("tbx_live_a"), hash_device_key("tbx_live_b")) is False


def test_wrong_key_does_not_match_stored_hash():
    """Doğrulamanın uçtan uca anlamı: yanlış anahtar kayıtlı özeti tutturamaz."""
    stored = hash_device_key("tbx_live_dogru")
    assert hashes_match(hash_device_key("tbx_live_yanlis"), stored) is False


# ---------------------------------------------------------------------------
# generate_device_key — M5'te eklendi. Cihazın TEK kimlik kanıtı bu değerdir;
# tahmin edilebilir olması, saldırganın başkasının cihazı adına veri
# göndermesi (ve komut alması) demektir.
# ---------------------------------------------------------------------------


def test_generated_key_carries_the_prefix():
    """Ön ek, anahtarı bir kayıt içinde gözle tanınır kılar."""
    assert generate_device_key().startswith(KEY_PREFIX)


def test_generated_keys_are_unique():
    """Aynı anahtarın iki kez üretilmesi, iki cihazın tek satıra düşmesi olurdu.

    `devices.key_hash` üzerinde unique indeks var; çakışma sessiz değil ama
    ikinci cihazın kaydı hiç oluşmazdı.
    """
    keys = {generate_device_key() for _ in range(1000)}
    assert len(keys) == 1000


def test_generated_key_has_enough_entropy():
    """Rastgele bölüm kaba kuvvetle denenemeyecek kadar uzun olmalı.

    32 bayt base64url'e çevrildiğinde 43 karakter eder. Sınır 40 tutuldu:
    kodlama ayrıntısı değişse de asıl iddia (kısa/tahmin edilebilir bir
    anahtar üretilmiyor) korunsun.
    """
    suffix = generate_device_key()[len(KEY_PREFIX) :]
    assert len(suffix) >= 40


def test_generated_key_does_not_come_from_the_random_module():
    """Bu dosyadaki en kritik testlerden biri.

    `random` başlangıç değerinden (seed) türeyen TEKRARLANABİLİR bir dizi
    üretir: aynı seed, aynı sayılar. Anahtar üretimi oraya kayarsa hiçbir şey
    görünürde bozulmaz — anahtarlar hâlâ uzun, hâlâ ön ekli, testlerin çoğu
    hâlâ yeşil — ama üretilen değerler tahmin edilebilir olur.

    Seed aynı noktaya iki kez sabitlenip iki anahtar isteniyor: kaynak `random`
    olsaydı ikisi birebir aynı çıkardı.
    """
    random.seed(1234)
    first = generate_device_key()
    random.seed(1234)
    second = generate_device_key()

    assert first != second


def test_generated_key_hashes_like_any_other_key():
    """Üretim ile doğrulama aynı zinciri kullanmalı.

    Uçtan uca anlam: `POST /devices` bu özeti yazar, `require_device` aynı
    anahtardan aynı özeti hesaplayıp satırı bulur.
    """
    key = generate_device_key()
    assert hashes_match(hash_device_key(key), hash_device_key(key)) is True
