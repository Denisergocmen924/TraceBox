"""agent/core/shipper.py — teslim garantisi ve backoff.

Buradaki asıl soru tek: **kayıt spool'dan ne zaman silinir?** Cevap yalnızca
"collector 200 döndükten sonra" olabilir. Bu kural bozulursa agent hiçbir hata
vermeden çalışmaya devam eder, ölçümler gönderilmiş sayılıp silinir ve veri
geri getirilemez — sessiz bozulmanın tanımı budur.

Testler gerçek bir collector'a bağlanmaz; httpx'in `MockTransport`'u ile sahte
bir collector kurulur. Böylece 500, 401 ve bağlantı hatası gibi kolay
üretilemeyen durumlar birer satırla kurgulanabilir ve testler ağa çıkmaz.

Sahte collector `Shipper`'ın kendi HTTP istemcisinin yerine geçirilir; üretim
kodunda test için açılmış bir kanca yoktur.
"""

import json

import httpx
import pytest

from agent.core.config import Config
from agent.core.shipper import Shipper
from agent.core.spool import RECORD_LOG, RECORD_METRIC, Spool

CONFIG = Config(collector_url="https://collector.test", device_key="tbx_live_test")


class FakeCollector:
    """İstekleri kaydeden, yanıtları önceden belirlenmiş sahte collector.

    `outcomes` sırayla tüketilir: her eleman ya bir HTTP durum kodu ya da
    fırlatılacak bir httpx hatasıdır. Liste bitince yanıt 200 olur.
    """

    def __init__(self, *outcomes) -> None:
        self._outcomes = list(outcomes)
        self.requests: list[httpx.Request] = []
        self.bodies: list[dict] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.bodies.append(json.loads(request.content))

        outcome = self._outcomes.pop(0) if self._outcomes else 200
        if isinstance(outcome, Exception):
            raise outcome
        return httpx.Response(outcome)


@pytest.fixture
def spool(tmp_path):
    """Üretim sınırlarıyla açılmış gerçek spool — silme davranışı burada ölçülür."""
    instance = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    yield instance
    instance.close()


def make_shipper(spool: Spool, collector: FakeCollector) -> Shipper:
    """Shipper'ı kurar ve HTTP istemcisini sahte collector'a bağlar."""
    shipper = Shipper(spool)
    shipper._client.close()
    shipper._client = httpx.Client(transport=httpx.MockTransport(collector.handle))
    return shipper


def fill(spool: Spool, count: int, record_type: str = RECORD_METRIC) -> None:
    """Spool'a numaralandırılmış `count` adet kayıt yazar."""
    for index in range(count):
        spool.add(record_type, {"uuid": f"kayit-{index}", "measured_at": "2026-08-23T10:00:00Z"})


def test_records_leave_the_spool_only_after_a_200(spool):
    """200 alınınca gönderilen kayıtlar spool'dan düşer."""
    fill(spool, 3)
    shipper = make_shipper(spool, FakeCollector(200))

    result = shipper.send_pending(CONFIG, [])

    assert result.ok is True
    assert result.sent == 3
    assert spool.count() == 0


def test_request_carries_the_device_key_and_grouped_payload(spool):
    """İstek /ingest'e gider, anahtarı taşır ve kayıtları türüne göre ayırır."""
    spool.add(RECORD_METRIC, {"uuid": "m1", "cpu_percent": 12.5})
    spool.add(RECORD_LOG, {"uuid": "l1", "level": "error", "message": "disk doldu"})
    collector = FakeCollector(200)
    shipper = make_shipper(spool, collector)

    shipper.send_pending(CONFIG, [])

    [request] = collector.requests
    assert str(request.url) == "https://collector.test/ingest"
    assert request.headers["Authorization"] == "Bearer tbx_live_test"

    [body] = collector.bodies
    assert [record["uuid"] for record in body["metrics"]] == ["m1"]
    assert [record["uuid"] for record in body["logs"]] == ["l1"]
    assert body["crash_snapshots"] == []


def test_server_error_leaves_every_record_in_the_spool(spool):
    """500 alınırsa hiçbir kayıt silinmez — veri sunucuya ulaşmış sayılamaz."""
    fill(spool, 3)
    shipper = make_shipper(spool, FakeCollector(500))

    result = shipper.send_pending(CONFIG, [])

    assert result.ok is False
    assert result.sent == 0
    assert spool.count() == 3


def test_connection_failure_leaves_every_record_in_the_spool(spool):
    """Bağlantı hiç kurulamazsa kayıtlar yerinde kalır ve sonraki turda tekrar denenir."""
    fill(spool, 3)
    shipper = make_shipper(spool, FakeCollector(httpx.ConnectError("bağlantı yok")))

    result = shipper.send_pending(CONFIG, [])

    assert result.ok is False
    assert spool.count() == 3
    assert "bağlanılamadı" in result.detail


def test_rejected_key_leaves_every_record_in_the_spool(spool):
    """401 bir teslim onayı DEĞİLDİR: anahtar reddedildiyse veri silinmez.

    Bu dal başarı sayılsaydı, yanlış anahtarla kurulmuş bir agent topladığı
    her şeyi hiçbir yere göndermeden silerdi.
    """
    fill(spool, 3)
    shipper = make_shipper(spool, FakeCollector(401))

    result = shipper.send_pending(CONFIG, [])

    assert result.ok is False
    assert spool.count() == 3
    assert "401" in result.detail


def test_only_the_confirmed_batch_leaves_the_spool(spool, monkeypatch):
    """Turun ortasında hata gelirse yalnızca onaylanmış batch silinir.

    Batch boyutu testte küçültülür; çok batch'li bir tur, üretim boyutunda
    (500 kayıt) yüzlerce kaydı diske yazmadan böyle kurulabilir.
    """
    monkeypatch.setattr("agent.core.shipper.BATCH_ROWS", 2)
    fill(spool, 5)
    shipper = make_shipper(spool, FakeCollector(200, 500))

    result = shipper.send_pending(CONFIG, [])

    assert result.ok is False
    # İlk iki kayıt onaylandı ve düştü; kalan üçü ikinci isteğin hatasıyla yerinde kaldı.
    assert result.sent == 2
    assert [record.uuid for record in spool.take(10)] == ["kayit-2", "kayit-3", "kayit-4"]


def test_command_acks_travel_only_in_the_first_request(spool, monkeypatch):
    """Komut ack'leri ilk isteğe binerse yeter — sonraki batch'lerde tekrarlanmaz."""
    monkeypatch.setattr("agent.core.shipper.BATCH_ROWS", 2)
    fill(spool, 4)
    collector = FakeCollector(200, 200)
    shipper = make_shipper(spool, collector)

    shipper.send_pending(CONFIG, ["komut-1"])

    assert [body["applied_command_ids"] for body in collector.bodies] == [["komut-1"], []]


def test_nothing_is_sent_when_there_is_nothing_to_send(spool):
    """Spool boş ve ack yoksa hiç istek atılmaz — boş gövde göndermenin karşılığı yok."""
    collector = FakeCollector()
    shipper = make_shipper(spool, collector)

    result = shipper.send_pending(CONFIG, [])

    assert result.ok is True
    assert result.sent == 0
    assert collector.requests == []


def test_backoff_doubles_after_each_failure(spool):
    """Ardışık hatalarda bekleme süresi ikiye katlanır ve gönderim kapanır."""
    fill(spool, 1)
    shipper = make_shipper(spool, FakeCollector(500, 500, 500))

    measured = []
    for _ in range(3):
        shipper.send_pending(CONFIG, [])
        measured.append(shipper.backoff_seconds)

    assert measured == [10.0, 20.0, 40.0]
    # Süre dolmadan yeni deneme yapılmaz.
    assert shipper.ready() is False


def test_backoff_stops_growing_at_the_ceiling(spool):
    """Bekleme süresi tavanı aşmaz — kapalı bir collector agent'ı sonsuza kadar susturmaz."""
    fill(spool, 1)
    shipper = make_shipper(spool, FakeCollector(*([500] * 12)))

    for _ in range(12):
        shipper.send_pending(CONFIG, [])

    assert shipper.backoff_seconds == 300.0


def test_success_clears_the_backoff(spool):
    """Bağlantı geri gelince bekleme sıfırlanır; birikmiş spool beklemeden boşalır."""
    fill(spool, 1)
    shipper = make_shipper(spool, FakeCollector(500, 200))

    shipper.send_pending(CONFIG, [])
    assert shipper.backoff_seconds == 10.0

    shipper.send_pending(CONFIG, [])

    assert shipper.backoff_seconds == 0.0
    assert shipper.ready() is True


def test_inventory_is_confirmed_only_by_a_200(spool):
    """Envanter yalnızca 200'de onaylanır.

    `known_inventory` ancak ok=True ile yazılır; başarısız bir gönderim başarılı
    sayılsaydı envanter bir daha hiç denenmez ve cihaz sunucuda eksik kalırdı.
    """
    shipper = make_shipper(spool, FakeCollector(500, 200))

    assert shipper.send_inventory(CONFIG, {"os_name": "Ubuntu"}).ok is False
    assert shipper.send_inventory(CONFIG, {"os_name": "Ubuntu"}).ok is True


# --- Komut ack'leri --------------------------------------------------------


def test_confirmed_acks_are_reported_back(spool):
    """200 alınan ack'ler sonuçta bildirilir; çağıran onları state'ten düşer.

    Bildirilmezlerse id'ler state'te kalır ve her gönderimde tekrar tekrar
    gönderilir — sunucu onları çoktan `applied` yapmışken.
    """
    fill(spool, 1)
    shipper = make_shipper(spool, FakeCollector(200))

    assert shipper.send_pending(CONFIG, ["komut-1"]).acked == ["komut-1"]


def test_acks_are_not_reported_when_the_request_fails(spool):
    """İstek başarısızsa ack onaylanmış sayılmaz.

    Sayılsaydı id state'ten düşer, sunucuya hiç ulaşmaz ve komut sonsuza kadar
    `pending` kalırdı: her poll'da yeniden gelir, agent'ın uyguladığı hiç
    bilinmezdi.
    """
    fill(spool, 1)
    shipper = make_shipper(spool, FakeCollector(500))

    result = shipper.send_pending(CONFIG, ["komut-1"])

    assert result.ok is False
    assert result.acked == []


def test_acks_confirmed_by_the_first_batch_survive_a_later_failure(spool, monkeypatch):
    """Tur yarıda kalsa bile ilk isteğin ack'i onaylanmıştır.

    Ack'ler yalnızca ilk isteğe biner; o istek 200 aldıysa komutlar sunucuda
    `applied` olmuştur. Sonraki batch'in hatası bu gerçeği geri almaz.
    """
    monkeypatch.setattr("agent.core.shipper.BATCH_ROWS", 2)
    fill(spool, 5)
    shipper = make_shipper(spool, FakeCollector(200, 500))

    result = shipper.send_pending(CONFIG, ["komut-1"])

    assert result.ok is False
    assert result.acked == ["komut-1"]


def test_ack_only_request_carries_no_measurements(spool):
    """send_acks bir KONTROL mesajıdır: gövdesinde tek ölçüm satırı yoktur.

    Spool dolu olsa bile ona dokunulmaz — bu istek pause sırasında da atılır ve
    telemetri taşısaydı pause'un anlamını çiğnerdi.
    """
    fill(spool, 3)
    collector = FakeCollector(200)
    shipper = make_shipper(spool, collector)

    result = shipper.send_acks(CONFIG, ["komut-1", "komut-2"])

    assert result.ok is True
    assert result.acked == ["komut-1", "komut-2"]
    assert collector.bodies == [
        {
            "metrics": [],
            "logs": [],
            "crash_snapshots": [],
            "applied_command_ids": ["komut-1", "komut-2"],
        }
    ]
    # Spool'a dokunulmadı: kayıtlar normal gönderimi bekliyor.
    assert spool.count() == 3


def test_ack_only_request_is_skipped_when_there_is_nothing_to_ack(spool):
    """Ack yoksa istek de yok — boş gövdenin karşılığı yok."""
    collector = FakeCollector()
    shipper = make_shipper(spool, collector)

    assert shipper.send_acks(CONFIG, []).ok is True
    assert collector.requests == []


def test_failed_ack_only_request_confirms_nothing(spool):
    """Ack isteği başarısızsa hiçbir id onaylanmaz; sonraki gönderime kalırlar."""
    shipper = make_shipper(spool, FakeCollector(500))

    result = shipper.send_acks(CONFIG, ["komut-1"])

    assert result.ok is False
    assert result.acked == []
