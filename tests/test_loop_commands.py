"""
agent/core/loop.py — komut turunun döngüye bağlanışı.

Uygulama mantığı commands.py'de sınandı; buradaki soru farklı: **poll turu
state'e ne yazar ve ack'i ne zaman atar?**

Ack gitmezse agent bunu ayrıca kaydetmez: komut sunucuda `pending` kalır, bir
sonraki poll'da yeniden gelir ve ack o turda tekrar denenir. Bu dosya o
yeniden denemeyi (aynı komutun iki turda gelmesini) sınar.
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


# --- ack ve state ----------------------------------------------------------


def test_an_applied_command_is_acked_and_the_state_is_saved(store, spool):
    """Olağan akış: komut uygulanır, durum diske yazılır ve ack hemen atılır."""
    state = store.load()
    shipper = FakeShipper()

    poll(FakePoller([Command(id="k1", type="pause")]), state, store, spool, shipper)

    assert state.logging_enabled is False
    assert store.load().logging_enabled is False
    assert shipper.calls == [["k1"]]


def test_a_failed_ack_is_retried_when_the_command_comes_again(store, spool):
    """Bu dosyanın en kritik testi.

    Ack ulaşmazsa agent bir şey kaydetmez; sunucu komutu yeniden verir. Tekrar
    gelen komut durumu değiştirmez ama ack yeniden denenir — denenmezse komut
    sunucuda sonsuza kadar `pending` kalır ve dashboard duraklatılmış cihazı
    "çalışıyor" gösterir.
    """
    state = store.load()
    shipper = FakeShipper(ok=False)
    command = Command(id="k1", type="pause")

    poller = FakePoller([command], [command])

    poll(poller, state, store, spool, shipper)
    poll(poller, state, store, spool, shipper)

    assert state.logging_enabled is False
    assert shipper.calls == [["k1"], ["k1"]]


def test_a_repeated_command_does_not_rewrite_the_state(store, spool):
    """Durumu değiştirmeyen tekrar komutu diske yazmaz; yalnızca ack atılır."""
    state = store.load()
    state.logging_enabled = False
    shipper = FakeShipper()

    poll(FakePoller([Command(id="k1", type="pause")]), state, store, spool, shipper)

    assert shipper.calls == [["k1"]]
    assert not store.path.exists()


def test_an_unknown_command_is_not_acked(store, spool):
    """Uygulanmayan komut ack edilmez; komut kuyrukta bekler."""
    state = store.load()
    shipper = FakeShipper()

    poll(FakePoller([Command(id="k9", type="reboot")]), state, store, spool, shipper)

    assert shipper.calls == []


# --- turun döngüye etkisi --------------------------------------------------


def test_a_failed_poll_does_not_stop_the_agent(store, spool, capsys):
    """Collector'a ulaşılamaması toplamayı ve gönderimi durdurmaz.

    Durdursaydı geçici bir ağ kesintisi agent'ı tamamen susturur, çöküş anına
    ait veri hiç toplanmazdı.
    """
    state = store.load()

    stopped = poll(FakePoller(CommandError("bağlanılamadı")), state, store, spool, FakeShipper())

    assert stopped is False
    assert "could not fetch commands" in capsys.readouterr().out


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
