"""
agent/core/loop.py — komut turunun döngüye bağlanışı.

Uygulama mantığı commands.py'de sınandı; buradaki soru farklı: **ack edilen
id'ler state'te ne zaman durur, ne zaman düşer?**

Bu, gözle görülmeyen bir muhasebedir. Yanlış tarafa kayarsa iki sessiz bozukluk
üretir: id erken düşerse komut sunucuda sonsuza kadar `pending` kalır (dashboard
"duraklatıldı" demez); geç düşerse agent aynı ack'i her gönderimde tekrar
tekrar yollar. İkisinde de hata mesajı yok.
"""

from __future__ import annotations

import pytest

from agent.core import loop
from agent.core.commands import Command, CommandError
from agent.core.config import Config
from agent.core.shipper import SendResult
from agent.core.spool import Spool
from agent.core.state import StateStore

CONFIG = Config(collector_url="https://collector.test", device_key="tbx_live_test")


class FakePoller:
    """Sırayla tüketilen poll sonuçları; eleman bir liste ya da fırlatılacak hata."""

    def __init__(self, *rounds) -> None:
        self._rounds = list(rounds)

    def fetch(self, config):
        outcome = self._rounds.pop(0) if self._rounds else []
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeShipper:
    """`send_acks` çağrılarını kaydeder; `ok` sonucu testten verilir."""

    def __init__(self, ok: bool = True) -> None:
        self._ok = ok
        self.calls: list[list[str]] = []

    def send_acks(self, config, command_ids: list[str]) -> SendResult:
        self.calls.append(list(command_ids))
        return SendResult(ok=self._ok, detail="" if self._ok else "HTTP 500")


@pytest.fixture
def spool(tmp_path):
    instance = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    yield instance
    instance.close()


@pytest.fixture
def store(tmp_path):
    return StateStore(tmp_path)


def poll(poller, state, store, spool, shipper) -> bool:
    return loop._poll_commands(poller, CONFIG, state, store, spool, shipper)


# --- state muhasebesi ------------------------------------------------------


def test_only_the_confirmed_ids_leave_the_state(store):
    """"Listeyi boşalt" değil, "onaylananları çıkar".

    Bugün fark görünmez (tek döngü var), ama kural yanlış yazılırsa ileride
    gönderim sırasında uygulanan bir komutun ack'i sessizce yutulur.
    """
    state = store.load()
    state.applied_command_ids = ["k1", "k2", "k3"]

    loop._prune_acked(state, store, ["k2"])

    assert state.applied_command_ids == ["k1", "k3"]
    assert store.load().applied_command_ids == ["k1", "k3"], "değişiklik diske yazılmadı"


def test_nothing_is_written_when_nothing_was_confirmed(store):
    """Onay yoksa diske yazma da yok — her turda gereksiz fsync yapılmaz."""
    state = store.load()
    state.applied_command_ids = ["k1"]

    loop._prune_acked(state, store, [])

    assert state.applied_command_ids == ["k1"]
    assert not store.path.exists()


def test_an_acked_command_leaves_no_debt_behind(store, spool):
    """Olağan akış: komut uygulanır, hemen ack'lenir ve state temiz kalır."""
    state = store.load()
    shipper = FakeShipper()

    poll(FakePoller([Command(id="k1", type="pause")]), state, store, spool, shipper)

    assert state.logging_enabled is False
    assert shipper.calls == [["k1"]]
    assert state.applied_command_ids == []
    assert store.load().applied_command_ids == []


def test_an_unconfirmed_ack_stays_in_the_state_for_the_next_send(store, spool):
    """Ack ulaşmadıysa id state'te KALIR ve sonraki gönderime piggyback olur.

    Kalmazsa komut hiç bildirilmemiş olur: sunucu onu her poll'da yeniden verir,
    `devices.logging_enabled` kopyası hiç güncellenmez.
    """
    state = store.load()

    poll(FakePoller([Command(id="k1", type="pause")]), state, store, spool, FakeShipper(ok=False))

    assert state.applied_command_ids == ["k1"]
    assert store.load().applied_command_ids == ["k1"], "borç diske yazılmadı"


def test_a_redelivered_command_is_acked_again_without_being_listed_twice(store, spool):
    """Bu dosyanın en kritik testi.

    Komutun tekrar gelmesi ack'in ulaşmadığı anlamına gelir; ack yeniden
    denenmelidir. Ama id state'e İKİNCİ kez yazılmamalıdır — yazılsaydı liste
    her turda büyür ve aynı id gönderimde defalarca tekrarlanırdı.
    """
    state = store.load()
    state.logging_enabled = False
    state.applied_command_ids = ["k1"]
    shipper = FakeShipper(ok=False)

    poll(FakePoller([Command(id="k1", type="pause")]), state, store, spool, shipper)

    assert shipper.calls == [["k1"]], "tekrar gelen komut yeniden ack edilmedi"
    assert state.applied_command_ids == ["k1"], "aynı id listeye iki kez yazıldı"


def test_an_unknown_command_creates_no_debt(store, spool):
    """Uygulanmayan komut ack edilmez, dolayısıyla state'e de girmez."""
    state = store.load()
    shipper = FakeShipper()

    poll(FakePoller([Command(id="k9", type="reboot")]), state, store, spool, shipper)

    assert shipper.calls == []
    assert state.applied_command_ids == []


# --- turun döngüye etkisi --------------------------------------------------


def test_a_failed_poll_does_not_stop_the_agent(store, spool, capsys):
    """Collector'a ulaşılamaması toplamayı ve gönderimi durdurmaz.

    Durdursaydı geçici bir ağ kesintisi agent'ı tamamen susturur, çöküş anına
    ait veri hiç toplanmazdı.
    """
    state = store.load()

    stopped = poll(FakePoller(CommandError("bağlanılamadı")), state, store, spool, FakeShipper())

    assert stopped is False
    assert "komutlar alınamadı" in capsys.readouterr().out


def test_an_empty_queue_costs_nothing(store, spool):
    """Çoğu poll boş döner: ne ack atılır ne diske yazılır."""
    state = store.load()
    shipper = FakeShipper()

    assert poll(FakePoller([]), state, store, spool, shipper) is False
    assert shipper.calls == []
    assert not store.path.exists()


def test_delete_tells_the_loop_to_stop(store, spool):
    """`delete` uygulandıktan sonra döngü devam etmemeli.

    Etseydi agent, kaydı sunucudan silinmiş bir cihaz için ölçüm toplamaya ve
    401 alan istekler atmaya devam ederdi.
    """
    state = store.load()

    assert poll(FakePoller([Command(id="sil", type="delete")]), state, store, spool, FakeShipper())


def test_a_postponed_delete_lets_the_loop_continue(store, spool):
    """Ack gitmediyse silme olmamıştır; agent çalışmaya devam eder ve tekrar dener."""
    state = store.load()

    stopped = poll(
        FakePoller([Command(id="sil", type="delete")]), state, store, spool, FakeShipper(ok=False)
    )

    assert stopped is False
    assert store.is_deleted() is False


# --- normal gönderime binen ack'ler ----------------------------------------


class FakeSender:
    """`send_pending` sonucunu testin verdiği şekilde döndüren sahte shipper."""

    def __init__(self, result: SendResult) -> None:
        self._result = result
        self.backoff_seconds = 0.0
        self.seen: list[list[str]] = []

    def send_pending(self, config, applied_command_ids: list[str]) -> SendResult:
        self.seen.append(list(applied_command_ids))
        return self._result


def test_acks_that_ride_along_with_a_normal_send_leave_the_state(store, spool):
    """Ack'in ikinci yolu: `POST /ingest` gövdesine binmek (CLAUDE.md §4.2).

    Ack'ler oraya da bindiği için düşme kuralı iki yerde birden geçerlidir;
    yalnızca poll tarafında uygulanırsa id'ler sonsuza kadar her gövdede
    tekrarlanır.
    """
    state = store.load()
    state.applied_command_ids = ["k1", "k2"]

    loop._send_spool(
        FakeSender(SendResult(ok=True, sent=2, acked=["k1"])), CONFIG, state, store, spool
    )

    assert state.applied_command_ids == ["k2"]


def test_acks_confirmed_before_a_failure_still_leave_the_state(store, spool):
    """Tur yarıda kalsa bile ilk isteğin ack'i onaylanmıştır.

    Ack'ler yalnızca ilk isteğe biner; o istek 200 aldıysa komutlar sunucuda
    `applied` olmuştur. Sonraki batch'in hatası bunu geri almaz — id'ler yine
    düşer, yoksa bir daha hiç bildirilmeyecek komutlar için sonsuza kadar
    taşınırlar.
    """
    state = store.load()
    state.applied_command_ids = ["k1"]

    loop._send_spool(
        FakeSender(SendResult(ok=False, sent=2, detail="HTTP 500", acked=["k1"])),
        CONFIG,
        state,
        store,
        spool,
    )

    assert state.applied_command_ids == []
