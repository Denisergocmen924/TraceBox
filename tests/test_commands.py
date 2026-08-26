"""agent/core/commands.py — komut teslimi, uygulanması ve `delete` sırası.

Üç ayrı soru sınanır:

1. **Poll dayanıklı mı?** Komut alınamaması agent'ı durdurmamalı; bozuk bir
   kayıt diğerlerini (özellikle `resume`u) düşürmemeli.
2. **Uygulama idempotent mi?** Sunucu ack'i görene kadar aynı komutu vermeye
   devam eder; ikinci `pause` hiçbir şeyi değiştirmemeli ama ack'i yeniden
   denenmeli — denenmezse duraklatılmış bir agent sonsuza kadar öyle kalır.
3. **`delete` sırası doğru mu?** Önce ack, sonra yerel silme (CLAUDE.md §11
   Boşluk E). Ters sırada anahtar giderdi ve ack hiç atılamazdı: sunucudaki
   cihaz kaydı ölümsüz kalırdı.

Ağa çıkılmaz. Poll için httpx'in MockTransport'u, ack için sahte bir shipper
kullanılır; gerçek olan state ve spool'dur — silmenin gerçekten olup olmadığı
ancak diskteki dosyalara bakarak ölçülebilir.
"""

import httpx
import pytest

from agent.core import commands as commands_module
from agent.core.commands import Command, CommandError, CommandPoller
from agent.core.config import Config
from agent.core.shipper import SendResult
from agent.core.spool import RECORD_METRIC, Spool
from agent.core.state import StateStore

CONFIG = Config(collector_url="https://collector.test", device_key="tbx_live_test")


class FakeShipper:
    """`send_acks` çağrılarını kaydeden sahte shipper.

    `on_send`, ack atıldığı ANDA çalışır. Silme sırasını ölçmenin başka yolu
    yok: sıranın doğru olduğunu ancak "ack sırasında yerel veri hâlâ duruyor
    muydu?" sorusuna bakarak anlarız.
    """

    def __init__(self, *outcomes: bool, on_send=None) -> None:
        self._outcomes = list(outcomes)
        self._on_send = on_send
        self.calls: list[list[str]] = []

    def send_acks(self, config, command_ids: list[str]) -> SendResult:
        self.calls.append(list(command_ids))
        if self._on_send is not None:
            self._on_send()

        ok = self._outcomes.pop(0) if self._outcomes else True
        return SendResult(
            ok=ok,
            detail="" if ok else "HTTP 500",
            acked=list(command_ids) if ok else [],
        )


@pytest.fixture
def spool(tmp_path):
    instance = Spool(tmp_path, max_age_days=10, max_size_mb=200)
    yield instance
    instance.close()


@pytest.fixture
def store(tmp_path):
    return StateStore(tmp_path)


@pytest.fixture
def messages() -> list[str]:
    """Toplanan konsol satırları — `log` yerine geçer."""
    return []


def make_poller(handler) -> CommandPoller:
    """Poller'ı kurar ve HTTP istemcisini sahte collector'a bağlar."""
    poller = CommandPoller()
    poller.close()
    poller._client = httpx.Client(transport=httpx.MockTransport(handler))
    return poller


def respond(body, status: int = 200):
    """Sabit bir yanıt döndüren MockTransport işleyicisi."""

    def handler(request: httpx.Request) -> httpx.Response:
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)

    return handler


def apply(commands, *, state, store, spool, shipper, messages, config=CONFIG):
    return commands_module.apply_commands(
        commands,
        config=config,
        state=state,
        store=store,
        spool=spool,
        shipper=shipper,
        log=messages.append,
    )


# --- Poll ------------------------------------------------------------------


def test_poll_asks_the_commands_endpoint_with_the_device_key():
    """Cihaz kimliği yalnızca anahtardan türetilir (CLAUDE.md §11 Boşluk A).

    URL'de device_id taşınsaydı, herkes başkasının cihaz id'sini yazarak onun
    komutlarını okumayı deneyebilirdi.
    """
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"commands": []})

    make_poller(handler).fetch(CONFIG)

    assert str(seen[0].url) == "https://collector.test/commands"
    assert seen[0].headers["Authorization"] == "Bearer tbx_live_test"


def test_commands_arrive_in_the_order_the_server_gave_them():
    """Sıra korunur: aynı turda pause + resume geldiyse sonuncusu kazanmalı."""
    poller = make_poller(
        respond({"commands": [{"id": "a", "type": "pause"}, {"id": "b", "type": "resume"}]})
    )

    assert poller.fetch(CONFIG) == [Command(id="a", type="pause"), Command(id="b", type="resume")]


def test_empty_queue_is_not_an_error():
    """Beklenen durum bu: çoğu poll boş döner."""
    assert make_poller(respond({"commands": []})).fetch(CONFIG) == []


@pytest.mark.parametrize(
    "status, expected",
    [(401, "401"), (500, "500"), (404, "404")],
    ids=["anahtar reddedildi", "sunucu hatası", "yol yok"],
)
def test_failed_poll_is_reported_not_swallowed(status, expected):
    """Hata sessizce "komut yok"a dönüşmemeli.

    Dönüşseydi, anahtarı reddedilen bir agent hiçbir uyarı vermeden sonsuza
    kadar boş kuyruk görürdü.
    """
    poller = make_poller(respond({}, status))

    with pytest.raises(CommandError) as error:
        poller.fetch(CONFIG)

    assert expected in str(error.value)


def test_connection_failure_is_reported():
    """Collector kapalıyken poll patlamaz, anlaşılır bir hata verir."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("bağlantı yok")

    with pytest.raises(CommandError):
        make_poller(handler).fetch(CONFIG)


def test_response_that_is_not_json_is_reported():
    """Araya giren bir vekil (proxy) HTML hata sayfası döndürebilir."""
    with pytest.raises(CommandError):
        make_poller(respond("<html>502</html>")).fetch(CONFIG)


def test_response_with_an_unexpected_shape_is_reported():
    """Sözleşme `{"commands": [...]}`; başka bir şekil komut kaybı demektir."""
    with pytest.raises(CommandError):
        make_poller(respond({"items": []})).fetch(CONFIG)


def test_a_malformed_command_does_not_take_the_others_down():
    """Bozuk tek kayıt atlanır, turun geri kalanı uygulanır.

    Tüm turu düşürmek `resume`u kaybetmek olurdu: duraklatılmış agent, bozuk
    bir komut yüzünden bir daha hiç açılmazdı.
    """
    poller = make_poller(
        respond(
            {
                "commands": [
                    {"id": 7, "type": "pause"},
                    "çöp",
                    {"type": "pause"},
                    {"id": "b", "type": "resume"},
                ]
            }
        )
    )

    assert poller.fetch(CONFIG) == [Command(id="b", type="resume")]


# --- pause / resume --------------------------------------------------------


def test_pause_stops_sending_and_is_acked(store, spool, messages):
    state = store.load()

    result = apply(
        [Command(id="k1", type="pause")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert state.logging_enabled is False
    assert result.state_changed is True
    assert result.applied_ids == ["k1"]


def test_resume_turns_sending_back_on(store, spool, messages):
    state = store.load()
    state.logging_enabled = False

    apply(
        [Command(id="k2", type="resume")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert state.logging_enabled is True


def test_a_repeated_command_changes_nothing_but_is_acked_again(store, spool, messages):
    """Bu dosyadaki en kritik testlerden biri.

    Komutun tekrar gelmesi, ack'in ULAŞMADIĞI anlamına gelir. Uygulama
    idempotenttir (durum zaten istenen değerde, değiştirilecek bir şey yok) ama
    ack yeniden denenmelidir. Denenmezse sunucu komutu her poll'da yeniden
    verir, agent her seferinde "zaten uygulanmış" deyip susar ve
    `devices.logging_enabled` kopyası hiç güncellenmez: dashboard duraklatılmış
    cihazı sonsuza kadar "çalışıyor" gösterir.
    """
    state = store.load()
    state.logging_enabled = False

    result = apply(
        [Command(id="k1", type="pause")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert state.logging_enabled is False
    assert result.state_changed is False, "değişmeyen durum için diske yazılıyor"
    assert result.applied_ids == ["k1"], "tekrar gelen komut ack edilmiyor"


def test_the_last_command_of_a_round_wins(store, spool, messages):
    """Sunucu satırları created_at sırasıyla verir; son verilen geçerlidir."""
    state = store.load()

    result = apply(
        [Command(id="k1", type="pause"), Command(id="k2", type="resume")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert state.logging_enabled is True
    assert result.applied_ids == ["k1", "k2"], "ara komut ack edilmemiş"


def test_an_unknown_command_type_is_not_acked(store, spool, messages):
    """Anlaşılmayan komut ack EDİLMEZ.

    Ack edilseydi sunucu onu `applied` sayar ve bir daha vermezdi: agent'ın
    hiç uygulamadığı bir talimat, dashboard'da uygulanmış görünürdü. Ack
    edilmeyince komut kuyrukta bekler ve agent güncellendiğinde çalışır.
    """
    state = store.load()

    result = apply(
        [Command(id="k9", type="reboot")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert result.applied_ids == []
    assert result.state_changed is False


# --- ack ------------------------------------------------------------------


def test_applied_commands_are_acked_right_away(messages):
    """Ack telemetriye bağlanmaz — pause hâlinde gönderim durur, ack durmaz."""
    shipper = FakeShipper()

    confirmed = commands_module.ack_now(
        ["k1", "k2"], config=CONFIG, shipper=shipper, log=messages.append
    )

    assert shipper.calls == [["k1", "k2"]]
    assert confirmed == ["k1", "k2"]


def test_nothing_is_acked_when_there_is_nothing_to_ack(messages):
    shipper = FakeShipper()

    assert commands_module.ack_now([], config=CONFIG, shipper=shipper, log=messages.append) == []
    assert shipper.calls == []


def test_a_failed_ack_confirms_nothing(messages):
    """Başarısız ack'te id'ler state'te kalır ve sonraki gönderime piggyback olur."""
    confirmed = commands_module.ack_now(
        ["k1"], config=CONFIG, shipper=FakeShipper(False), log=messages.append
    )

    assert confirmed == []


# --- delete ---------------------------------------------------------------


def fill(spool: Spool, store: StateStore) -> None:
    """Silinecek gerçek veri: birkaç spool kaydı ve diskte bir state.json."""
    spool.add(RECORD_METRIC, {"uuid": "kayit-1", "measured_at": "2026-08-26T10:00:00Z"})
    store.save(store.load())


def test_delete_acks_before_wiping_anything(store, spool, messages):
    """Bu dosyanın en kritik testi (CLAUDE.md §11 Boşluk E).

    Sıra tersine dönerse anahtar (ve state) ack atılmadan silinir; ack hiç
    gitmez, collector cihaz satırını hiç silmez ve kayıt sunucuda ölümsüz
    kalır. Kod yine çalışır, hiçbir hata görünmez — bozukluğun tek bekçisi bu
    testtir.
    """
    fill(spool, store)
    alive_at_ack: list[bool] = []

    shipper = FakeShipper(on_send=lambda: alive_at_ack.append(spool.path.exists()))

    apply(
        [Command(id="sil", type="delete")],
        state=store.load(),
        store=store,
        spool=spool,
        shipper=shipper,
        messages=messages,
    )

    assert shipper.calls == [["sil"]]
    assert alive_at_ack == [True], "ack atılmadan önce yerel veri silinmiş"


def test_delete_removes_the_local_data(store, spool, messages):
    """Cihaz silindi: ölçümler de state de makinede kalmamalı."""
    fill(spool, store)

    result = apply(
        [Command(id="sil", type="delete")],
        state=store.load(),
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert result.deleted is True
    assert not spool.path.exists()
    assert not store.path.exists()


def test_delete_leaves_the_marker_that_triggers_the_uninstall(store, spool, messages):
    """Kaldırmanın root tarafını başlatan tek şey bu dosyadır.

    Agent yetkisiz çalışır ve /opt, /etc ile systemd'ye dokunamaz; bırakabildiği
    tek iz, kendi state dizinindeki bu işaret. Düşerse cihaz sunucudan silinir
    ama servis makinede çalışmaya devam eder — her poll'da 401 alan bir hayalet.
    """
    fill(spool, store)

    apply(
        [Command(id="sil", type="delete")],
        state=store.load(),
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert store.is_deleted() is True
    assert store.deleted_marker_path.exists()


def test_delete_is_postponed_when_the_ack_does_not_get_through(store, spool, messages):
    """Ack ulaşmadıysa hiçbir şey silinmez.

    Silinseydi anahtar giderdi: komut sunucuda `pending` kalır, agent bir daha
    ack atamaz ve cihaz kaydı elle silinene kadar orada durur.
    """
    fill(spool, store)

    result = apply(
        [Command(id="sil", type="delete")],
        state=store.load(),
        store=store,
        spool=spool,
        shipper=FakeShipper(False),
        messages=messages,
    )

    assert result.deleted is False
    assert result.applied_ids == []
    assert spool.path.exists()
    assert store.path.exists()
    assert store.is_deleted() is False


def test_delete_ends_the_round(store, spool, messages):
    """Silmeden sonraki komutlar uygulanmaz — uygulanacak bir cihaz kalmadı."""
    state = store.load()
    state.logging_enabled = False
    fill(spool, store)

    apply(
        [Command(id="sil", type="delete"), Command(id="k2", type="resume")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(),
        messages=messages,
    )

    assert state.logging_enabled is False, "silinen cihazda sonraki komut uygulanmış"


def test_a_postponed_delete_also_ends_the_round(store, spool, messages):
    """Ack başarısızsa da tur biter: cihaz gitmek üzere, arkasını uygulamak anlamsız."""
    state = store.load()
    state.logging_enabled = False
    fill(spool, store)

    result = apply(
        [Command(id="sil", type="delete"), Command(id="k2", type="resume")],
        state=state,
        store=store,
        spool=spool,
        shipper=FakeShipper(False),
        messages=messages,
    )

    assert state.logging_enabled is False
    assert result.applied_ids == []
