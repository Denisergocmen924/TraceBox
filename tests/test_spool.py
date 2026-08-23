"""agent/core/spool.py — bekleyen kayıtların disk üzerindeki sırası ve kapasitesi.

Testler geçici bir dizinde GERÇEK bir SQLite dosyası açar. Sahte bir veritabanı
kullanılsaydı ölçülen şey spool'un davranışı değil, taklidin davranışı olurdu;
buradaki soruların çoğunun cevabı (silinen yer geri döner mi, kayıt yeniden
açılışta yerinde midir) doğrudan SQLite'ın davranışına bağlı.

Kapsanan sözleşmeler:
  - kayıtlar eklendikleri sırayla, eskiden yeniye okunur
  - yalnızca ack edilen kayıt silinir, kalanlar yerinde durur
  - ack edilmemiş kayıt agent yeniden başlasa da kaybolmaz
  - yaş ve boyut sınırı aşılınca EN ESKİ kayıtlar düşer

Boyut sınırı testi aynı zamanda `size_bytes`'ın ölçüm yöntemini korur: ölçüm
dosya boyutuna çevrilirse WAL modunda veri dosyada görünmez, sınır hiç aşılmış
sayılmaz ve halka tampon (ring buffer) sessizce çalışmayı bırakır.
"""

import pytest

from agent.core import spool as spool_module
from agent.core.spool import RECORD_LOG, RECORD_METRIC, Spool

# Boyut sınırı testinin kayıt başına taşıdığı yük. 5 KB'lık mesajlarla 1 MB'lık
# bütçe birkaç yüz kayıtta aşılır; testin bir megabaytı gerçekten doldurması
# gerekir, çünkü ölçülen şey SQLite'ın sayfa sayısıdır.
PAYLOAD_FILLER = "x" * 5000

SECONDS_PER_DAY = 86400


def make_record(uuid: str, **extra) -> dict:
    """Wire gövdesine girecek en küçük geçerli kayıt."""
    return {"uuid": uuid, "measured_at": "2026-08-23T10:00:00Z", **extra}


@pytest.fixture
def spool(tmp_path):
    """Üretim sınırlarıyla, geçici bir dizinde açılmış spool."""
    instance = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    yield instance
    instance.close()


def test_records_come_back_oldest_first(spool):
    """Okuma sırası eklenme sırasıdır — shipper spool'u eskiden yeniye boşaltır."""
    spool.add(RECORD_METRIC, make_record("bir"))
    spool.add(RECORD_METRIC, make_record("iki"))
    spool.add(RECORD_METRIC, make_record("uc"))

    assert [record.uuid for record in spool.take(10)] == ["bir", "iki", "uc"]


def test_payload_survives_the_round_trip(spool):
    """Yazılan gövde okunduğunda birebir aynıdır — tür etiketi de korunur."""
    payload = make_record("kayit", level="error", message="disk doldu — üstü çizili ölçüm")
    spool.add(RECORD_LOG, payload)

    [record] = spool.take(10)

    assert record.type == RECORD_LOG
    assert record.payload == payload


def test_take_returns_at_most_the_requested_count(spool):
    """`limit` bir üst sınırdır: shipper tek istekte ne kadar taşıyacağını buradan belirler."""
    for index in range(5):
        spool.add(RECORD_METRIC, make_record(f"kayit-{index}"))

    assert [record.uuid for record in spool.take(2)] == ["kayit-0", "kayit-1"]


def test_ack_deletes_only_the_acknowledged_records(spool):
    """Ack edilen kayıt gider, edilmeyen kalır ve sıradaki okumada geri gelir."""
    spool.add(RECORD_METRIC, make_record("gonderildi"))
    spool.add(RECORD_METRIC, make_record("bekliyor"))

    spool.ack(["gonderildi"])

    assert spool.count() == 1
    assert [record.uuid for record in spool.take(10)] == ["bekliyor"]


def test_records_survive_a_restart(tmp_path):
    """Kapanıp yeniden açılan spool bekleyen kayıtları geri verir.

    Agent yeniden başladığında (systemd restart, makine açılışı) gönderilmemiş
    veri diskte durmalıdır; spool'un tüm varlık sebebi budur.
    """
    first = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    first.add(RECORD_METRIC, make_record("gonderilmemis"))
    first.close()

    second = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    try:
        assert [record.uuid for record in second.take(10)] == ["gonderilmemis"]
    finally:
        second.close()


def test_records_older_than_the_age_limit_are_dropped(tmp_path, monkeypatch):
    """Yaş sınırını aşan kayıt, sonraki eklemede düşer.

    Kaydın yaşını sistem saatiyle beklemek yerine spool'un okuduğu saat geriye
    alınır: 11 gün önce yazılmış bir kayıt, 10 günlük sınırın dışında kalır.
    """
    spool = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    try:
        # Kayıt 11 gün önce eklenmiş gibi damgalanır. Sınır kontrolü de aynı
        # geçmiş saati gördüğü için kayıt kendi eklenişinde düşmez.
        real_time = spool_module.time.time
        monkeypatch.setattr(
            spool_module.time, "time", lambda: real_time() - 11 * SECONDS_PER_DAY
        )
        spool.add(RECORD_METRIC, make_record("onbir-gunluk"))
        assert spool.count() == 1

        # Saat bugüne döner; yeni ekleme sınır kontrolünü bugünün ölçütüyle çalıştırır.
        monkeypatch.undo()
        spool.add(RECORD_METRIC, make_record("bugunku"))

        assert [record.uuid for record in spool.take(10)] == ["bugunku"]
    finally:
        spool.close()


def test_size_limit_drops_the_oldest_records(tmp_path):
    """Boyut sınırı aşılınca en eski kayıtlar düşer, en yeniler kalır.

    Halka tamponun yönü kritik: yeni kayıtlar reddedilseydi çöküş anına en yakın
    veri — yani spool'un korumak için var olduğu veri — hiç yazılamazdı.
    """
    spool = Spool(tmp_path, max_age_days=10, max_size_mb=1)
    try:
        for index in range(250):
            spool.add(RECORD_METRIC, make_record(f"kayit-{index:04d}", message=PAYLOAD_FILLER))

        remaining = spool.take(1000)

        # Sınır fiilen uygulanmış: kayıtların bir kısmı düşmüş ama spool boş değil.
        assert 0 < len(remaining) < 250
        # Düşenler baştan seçilmiş: elde kalan blok en son eklenen kayıtla biter.
        assert remaining[-1].uuid == "kayit-0249"
        assert remaining[0].uuid > "kayit-0000"
        # Ve sonuç bütçenin altında.
        assert spool.size_bytes() <= 1 * 1024 * 1024
    finally:
        spool.close()
