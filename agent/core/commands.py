"""
Komutlar — dashboard'un verdiği talimatları alır ve uygular.

Kuyruk tek yönlüdür: dashboard `commands` tablosuna bir satır ekler, agent
`GET /commands` ile onu alır, uygular ve id'sini ack olarak geri yollar. Sunucu
ack'i görene kadar aynı komutu vermeye devam eder — yani teslim garantisi
burada da **at-least-once**'tır ve uygulama bu yüzden **idempotent** olmalıdır:
zaten duraklatılmış bir agent'a gelen ikinci `pause` hiçbir şey değiştirmez.

Poll'ün kendi HTTP istemcisi var, Shipper'ınki kullanılmaz: gönderim durmuşken
(pause) ya da backoff sırasında bile komut sorulmaya devam eder — durursa
`resume` cihaza hiç ulaşamaz.

`state.logging_enabled`'ın TEK YAZARI burasıdır. Sunucudaki
`devices.logging_enabled` sütunu bunun kopyasıdır ve ancak ack ulaştığında
güncellenir.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

COMMANDS_PATH = "/commands"

# Poll, döngünün turunu bloklar; collector yanıt vermiyorsa tur uzamasın.
REQUEST_TIMEOUT_SECONDS = 10.0

PAUSE = "pause"
RESUME = "resume"
DELETE = "delete"

# pause/resume'un state karşılığı. `delete` burada yok: o bir ayar değişikliği
# değil, agent'ın kendini kapatması.
LOGGING_STATE_BY_TYPE = {PAUSE: False, RESUME: True}


class CommandError(Exception):
    """Komutlar sorulamadı — ağ, yetki ya da beklenmeyen yanıt."""


@dataclass(frozen=True)
class Command:
    """Sunucudan gelen tek bir komut. Sözleşme iki alandan ibaret (§4.2)."""

    id: str
    type: str


@dataclass(frozen=True)
class CommandResult:
    """Bir poll turunun sonucu.

    `applied_ids`: ack'lenmeyi bekleyen YENİ id'ler.
    `state_changed`: state.json diske yazılmalı mı.
    `deleted`: cihaz kaydı silindi, agent duracak.
    """

    applied_ids: list[str] = field(default_factory=list)
    state_changed: bool = False
    deleted: bool = False


class CommandPoller:
    """`GET /commands` — kendi istemcisiyle, backoff'suz."""

    def __init__(self) -> None:
        self._client = httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS)

    def fetch(self, config) -> list[Command]:
        """Bekleyen komutları getirir; sorun varsa CommandError fırlatır.

        Backoff yok: poll zaten seyrektir (varsayılan 10 sn) ve kapalı bir
        collector'a atılan istek başarısız olup geçer. Gönderimdeki backoff'un
        sebebi birikmiş veriyi tekrar tekrar yüklemeye çalışmaktı; burada
        gövde boş.
        """
        url = f"{config.collector_url.rstrip('/')}{COMMANDS_PATH}"
        headers = {"Authorization": f"Bearer {config.device_key}"}

        try:
            response = self._client.get(url, headers=headers)
        except httpx.HTTPError as error:
            raise CommandError(f"bağlanılamadı ({error.__class__.__name__})") from error

        if response.status_code == 401:
            raise CommandError("cihaz anahtarı reddedildi (401)")

        if response.status_code != 200:
            raise CommandError(f"HTTP {response.status_code}")

        try:
            body = response.json()
        except ValueError as error:
            raise CommandError("yanıt JSON değil") from error

        return _parse(body)

    def close(self) -> None:
        self._client.close()


def _parse(body) -> list[Command]:
    """Yanıt gövdesini Command listesine çevirir.

    Biçimi bozuk tek bir kayıt turu düşürmez, yalnızca kendisi atlanır: bir
    komut yüzünden diğerlerini (özellikle `resume`u) kaybetmek daha kötüdür.
    """
    if not isinstance(body, dict) or not isinstance(body.get("commands"), list):
        raise CommandError("yanıt beklenen şekilde değil")

    commands = []
    for item in body["commands"]:
        if not isinstance(item, dict):
            continue
        identifier, type_ = item.get("id"), item.get("type")
        if isinstance(identifier, str) and isinstance(type_, str):
            commands.append(Command(id=identifier, type=type_))

    return commands


def apply_commands(commands, *, config, state, store, spool, shipper, log) -> CommandResult:
    """Komutları sırayla uygular ve turun sonucunu döndürür.

    Sunucu satırları `created_at` artan sırada verir; liste bu sırayla işlenir,
    yani aynı turda pause + resume geldiyse son verilen kazanır.
    """
    applied: list[str] = []
    state_changed = False

    for command in commands:
        if command.type == DELETE:
            if _delete(command, config=config, store=store, spool=spool, shipper=shipper, log=log):
                return CommandResult(applied_ids=applied, state_changed=state_changed, deleted=True)
            # Ack gitmediyse silme yarım kalmasın diye tur burada biter: komut
            # sunucuda `pending` durur ve bir sonraki poll'da tekrar gelir.
            # Arkasındaki komutları uygulamanın da anlamı yok, cihaz gidiyor.
            break

        if command.type in LOGGING_STATE_BY_TYPE:
            wanted = LOGGING_STATE_BY_TYPE[command.type]
            if state.logging_enabled != wanted:
                state.logging_enabled = wanted
                state_changed = True
                log(f"[cmd] {command.type} uygulandı — logging_enabled={wanted}")
            else:
                # Ack henüz ulaşmadığı için tekrar gönderilmiş komut. Uygulama
                # idempotent: durum zaten istenen değerde.
                log(f"[cmd] {command.type} zaten uygulanmış — ack tekrar denenecek")

            # Zaten ack listesinde olsa bile buraya yazılır: komutun tekrar
            # gelmesi ack'in ulaşmadığı anlamına gelir, yani tekrar denenmeli.
            if command.id not in applied:
                applied.append(command.id)
            continue

        # Bilinmeyen tür ACK EDİLMEZ. Ack etseydik sunucu komutu `applied`
        # sayar ve bir daha vermezdi; yani agent'ın anlamadığı bir talimat
        # sessizce uygulanmış görünürdü. Ack edilmeyince komut kuyrukta kalır
        # ve agent güncellendiğinde uygulanır.
        log(f"[cmd] bilinmeyen komut türü '{command.type}' — yok sayıldı (ack edilmedi)")

    return CommandResult(applied_ids=applied, state_changed=state_changed)


def ack_now(applied_ids: list[str], *, config, shipper, log) -> list[str]:
    """Uygulanan komutları hemen ack'ler; onaylanan id'leri döndürür.

    Normalde ack'ler `POST /ingest` gövdesine biner (§4.2) — ama pause hâlinde
    gönderim durur ve o gövde hiç yola çıkmaz. Ack de gitmezse sunucu komutu
    her poll'da yeniden verir ve `devices.logging_enabled` kopyası hiç
    güncellenmez, yani dashboard cihazı hâlâ "çalışıyor" gösterir.

    Bu yüzden ack telemetriye bağlanmaz: uygulanan bir komut, gönderim açık da
    kapalı da olsa kendi küçük isteğiyle bildirilir. Bu bir KONTROL mesajıdır
    (spec'in `delete` ack'i için tanıdığı istisnanın aynı gerekçesi), ölçüm
    değil — gövdesinde tek bir ölçüm satırı bile yok.

    Başarısız olursa id'ler state'te kalır ve bir sonraki gönderime piggyback
    olur; kayıp yok, yalnızca gecikme.
    """
    if not applied_ids:
        return []

    result = shipper.send_acks(config, applied_ids)
    if not result.ok:
        log(f"[cmd] ack gönderilemedi: {result.detail} — sonraki gönderime bırakıldı")
        return []

    log(f"[cmd] {len(applied_ids)} komut ack'lendi")
    return list(applied_ids)


def _delete(command, *, config, store, spool, shipper, log) -> bool:
    """Silme akışı. SIRA KRİTİKTİR (CLAUDE.md §11 Boşluk E).

      1. ack gönderilir — pause'da bile, çünkü bu teardown kontrol mesajıdır,
      2. 200 alınır: collector `devices` satırını sildi (CASCADE ile veri de),
      3. yerel veri silinir (spool + state),
      4. kaldırma işareti bırakılır: gerisi root'un işi (aşağıda).

    Ters sıra iki türlü de bozardı: önce yerel silme yapılsaydı anahtar giderdi
    ve ack hiç atılamazdı; sunucu satırı erken silinseydi agent 401 alır,
    komutu hiç göremezdi.
    """
    log("[cmd] delete alındı — önce ack gönderiliyor.")

    result = shipper.send_acks(config, [command.id])
    if not result.ok:
        log(f"[cmd] delete ack gönderilemedi: {result.detail} — silme ertelendi.")
        return False

    log("[cmd] ack onaylandı: cihaz kaydı sunucudan silindi. Yerel temizlik başlıyor.")

    spool.wipe()
    log(f"[cmd] spool silindi: {spool.path}")

    store.wipe()
    log(f"[cmd] state silindi: {store.path}")

    # Kalanı (systemd servisi, /opt, /etc ve anahtarın kendisi) agent SİLEMEZ:
    # yetkisiz `tracebox` kullanıcısıyla, NoNewPrivileges=yes ve
    # ProtectSystem=strict altında çalışır — yazabildiği tek yer kendi state
    # dizinidir. Bu bilinçli bir kilit; delete uğruna gevşetilmez.
    #
    # Bunun yerine oraya bir işaret dosyası bırakılır: root tarafında çalışan
    # tracebox-uninstall.path onu görür ve uninstall.sh'i çalıştırır. Böylece
    # kaldırma, agent'ın yetkisini artırmadan tamamlanır.
    marker = store.mark_deleted()
    log(f"[cmd] kaldırma işareti bırakıldı: {marker}")
    log("[cmd] kaldırma tamamlanmazsa elle: sudo /opt/tracebox/uninstall.sh --yes")

    return True
