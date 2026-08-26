"""
Kurulum betikleri ve systemd birimleri — sözleşme testleri.

Kapsanan dosyalar: agent/install.sh · agent/uninstall.sh ·
agent/tracebox-agent.service · agent/tracebox-uninstall.path ·
agent/tracebox-uninstall.service.

Bu dosyalar bir birim testinde ÇALIŞTIRILAMAZ: kullanıcı oluşturur, sistem
dizinlerine yazar, systemd'ye dokunur. Doğru çalıştıkları tek seferlik olarak
atılabilir bir Docker konteynerinde elle doğrulandı.

Buradaki testler farklı bir soruya bakar: dosyalar SÖZLEŞMELERİNİ hâlâ tutuyor
mu? Bir düzenleme sırasında sessizce düşebilecek satırlar var — `chmod 600`,
`read -s`, `User=tracebox` — ve düştüklerinde kurulum yine "başarılı" der.
Kaybı fark eden başka hiçbir şey yok.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from agent.core.state import DEFAULT_STATE_DIR, DELETED_FILENAME

AGENT_DIR = Path(__file__).resolve().parent.parent / "agent"

INSTALL = AGENT_DIR / "install.sh"
UNINSTALL = AGENT_DIR / "uninstall.sh"
UNIT = AGENT_DIR / "tracebox-agent.service"

# `delete` komutunun root tarafı: agent yetkisiz çalıştığı için kendi kurulumunu
# kaldıramaz, yalnızca state dizinine bir işaret bırakır. Path unit onu görür,
# service unit kaldırma betiğini root olarak çalıştırır.
PATH_UNIT = AGENT_DIR / "tracebox-uninstall.path"
UNINSTALL_UNIT = AGENT_DIR / "tracebox-uninstall.service"

UNITS = [UNIT, PATH_UNIT, UNINSTALL_UNIT]
SCRIPTS = [INSTALL, UNINSTALL]

# Yalnızca geliştirme için var olan override'lar. Üretim yolunu ezerler; kurulum
# betiğine ya da unit dosyasına sızarlarsa agent /etc ve /var/lib yerine
# geliştiricinin klasörlerine bakar.
DEVELOPMENT_OVERRIDES = ["TRACEBOX_CONFIG", "TRACEBOX_STATE_DIR"]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def code(body: str) -> str:
    """Yorum satırlarını atar.

    İçerik iddiaları yorumlarla tatmin edilmemeli: bir bayrağı ANLATAN yorum,
    o bayrak koddan silinse bile metinde durur ve testi sahte biçimde geçirir.
    """
    return "\n".join(line for line in body.splitlines() if not line.strip().startswith("#"))


@pytest.fixture(scope="module")
def install_sh() -> str:
    return read(INSTALL)


@pytest.fixture(scope="module")
def uninstall_sh() -> str:
    return read(UNINSTALL)


@pytest.fixture(scope="module")
def unit() -> str:
    return read(UNIT)


@pytest.fixture(scope="module")
def path_unit() -> str:
    return read(PATH_UNIT)


@pytest.fixture(scope="module")
def uninstall_unit() -> str:
    return read(UNINSTALL_UNIT)


# --- Dosyaların kendisi ----------------------------------------------------


@pytest.mark.parametrize("path", SCRIPTS + UNITS, ids=lambda p: p.name)
def test_file_exists(path):
    """install.sh kurulum akışının TEK giriş noktası; eksikse akış kopar."""
    assert path.is_file()


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_script_is_executable(path):
    """Çalıştırma biti repo'da tutulmalı.

    Kaybolursa kullanıcı `./install.sh` deyip "Permission denied" alır ve
    kurulum daha ilk adımda durur.
    """
    assert path.stat().st_mode & 0o111


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
@pytest.mark.skipif(shutil.which("bash") is None, reason="bash yok")
def test_script_has_valid_syntax(path):
    """`bash -n`: betiği çalıştırmadan ayrıştırır.

    Sözdizimi hatası ancak kullanıcının makinesinde, kurulumun ortasında
    görülürdü — yarım kurulmuş bir sistem bırakarak.
    """
    result = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_script_stops_on_the_first_error(path):
    """`set -e` + `-u` + `pipefail` olmadan betik hatadan sonra DEVAM eder.

    Bu, kurulumun en tehlikeli hâlidir: indirme başarısız olur ama kullanıcı
    oluşturma, servis kurma ve "✓ tamamlandı" mesajı yine de çalışır.
    """
    body = read(path)
    assert re.search(r"^set -[Eeuo]*e[Eeuo]*uo pipefail$", body, re.MULTILINE), (
        "set -euo pipefail bulunamadı"
    )


# --- Kilitli kural: geliştirme override'ları sızmamalı ---------------------


@pytest.mark.parametrize("path", SCRIPTS + UNITS, ids=lambda p: p.name)
@pytest.mark.parametrize("variable", DEVELOPMENT_OVERRIDES)
def test_development_override_does_not_leak_into_production(path, variable):
    """Bu dosyadaki en kritik test.

    TRACEBOX_CONFIG, geliştirme sırasında config'i repo içindeki bir dosyaya
    yönlendirmek için var. Kurulum betiğine ya da unit dosyasına girerse üretim
    agent'ı /etc/tracebox/config.toml yerine başka bir yolu okur — ve orada bir
    dosya varsa hiçbir hata vermeden YANLIŞ ayarla çalışır.

    Sessiz olduğu için tek bekçisi bu testtir.
    """
    assert variable not in read(path)


# --- Anahtarın gizliliği ---------------------------------------------------


def test_config_file_is_locked_down(install_sh):
    """Düz anahtarı tutan tek dosya yalnızca sahibine açık olmalı.

    `chmod 600` düşerse dosya umask'e kalır (tipik olarak 644) ve makinedeki
    her yerel kullanıcı cihaz anahtarını okuyabilir.
    """
    assert "chmod 600" in install_sh


def test_key_prompt_does_not_echo(install_sh):
    """Anahtar yazılırken ekrana basılmamalı.

    `read -s` olmadan anahtar terminalde görünür, omuz üstünden okunur ve
    kaydedilen oturumlara (script, tmux, ekran paylaşımı) düşer.
    """
    assert re.search(r"read -r -s\b", install_sh)


def test_prompts_read_from_the_terminal_not_stdin(install_sh):
    """Kurulum `curl … | sudo bash` ile çalıştırılır.

    O akışta stdin BETİĞİN KENDİSİDİR: `read` stdin'den okusaydı, sorunun
    cevabı olarak betiğin bir sonraki satırını yutar ve anahtar hiç sorulmadan
    kurulum bozulurdu. Bu yüzden sorular /dev/tty'den okunur.
    """
    assert "/dev/tty" in install_sh
    assert not re.search(r"^\s*read -r[^<\n]*$", install_sh, re.MULTILINE), (
        "yönlendirmesiz bir read var — stdin'den okuyor"
    )


def test_key_is_never_printed_back(install_sh):
    """Alınan anahtar hiçbir çıktıda tekrarlanmamalı."""
    for line in install_sh.splitlines():
        if "${DEVICE_KEY}" in line and re.match(r"\s*(echo|printf|say)\b", line.strip()):
            pytest.fail(f"anahtar ekrana basılıyor: {line.strip()}")


def test_rollback_is_disabled_once_the_key_is_written(install_sh):
    """İkinci en kritik test.

    Anahtar YALNIZCA config.toml'da düz durur: sunucuda özeti var, dashboard
    onu bir kez gösterip unutur. Sonraki bir adım (systemd, verify) hata verip
    geri alma tetiklenirse config silinir ve anahtar KALICI olarak kaybolur —
    kullanıcı cihazı silip baştan oluşturmak zorunda kalır.

    Bu yüzden config yazıldıktan sonra geri alma kapatılır.
    """
    assert "ROLLBACK_ENABLED=0" in install_sh

    write_index = install_sh.index("chmod 600")
    disable_index = install_sh.index("ROLLBACK_ENABLED=0")
    assert disable_index > write_index, "geri alma, anahtar yazılmadan önce kapatılıyor"


# --- İndirme ---------------------------------------------------------------


def test_source_is_downloaded_over_https_only(install_sh):
    """Yönlendirme düz HTTP'ye düşerse indirme reddedilmeli.

    Kurulan şey /opt/tracebox'ta root'un kurduğu koddur; araya giren biri
    içeriği değiştirebilseydi makineye istediği kodu yazdırırdı.
    """
    body = code(install_sh)
    assert "--proto '=https'" in body, "curl düz HTTP'ye düşmeye açık"
    assert not re.search(r"http://[a-z]", body), "düz HTTP adresi var"


# --- systemd unit ----------------------------------------------------------


def test_service_does_not_run_as_root(unit):
    """En kritik unit testi.

    `User=` satırı düşerse systemd servisi ROOT olarak çalıştırır — ve hiçbir
    şey bozulmaz, agent gayet çalışır. Bir metrik toplayıcının makinedeki her
    dosyayı okuma/yazma yetkisi olması, sessiz ve kalıcı bir yetki artışıdır.
    """
    assert re.search(r"^User=tracebox$", unit, re.MULTILINE)
    assert not re.search(r"^User=root$", unit, re.MULTILINE)


def test_service_uses_the_virtualenv_interpreter(unit):
    """Sistem python3'ü psutil ve httpx'i görmez.

    ExecStart sistem yorumlayıcısına kayarsa servis her açılışta ImportError
    ile ölür ve systemd 5 denemede pes eder.
    """
    exec_start = re.search(r"^ExecStart=(.+)$", unit, re.MULTILINE)
    assert exec_start, "ExecStart yok"
    assert exec_start.group(1).startswith("/opt/tracebox/venv/bin/python")


def test_service_can_only_write_to_its_state_directory(unit):
    """Agent'ın yazdığı tek yer state.json + spool'dur."""
    assert re.search(r"^ProtectSystem=strict$", unit, re.MULTILINE)
    assert re.search(r"^ReadWritePaths=/var/lib/tracebox$", unit, re.MULTILINE)


def test_service_cannot_escalate_privileges(unit):
    """setuid ile yetki yükseltme yolu kapalı olmalı."""
    assert re.search(r"^NoNewPrivileges=yes$", unit, re.MULTILINE)


def test_service_has_a_crash_loop_brake(unit):
    """Sürekli çöken bir servis, journald'ı ve CPU'yu sonsuza dek meşgul eder."""
    assert re.search(r"^StartLimitBurst=\d+$", unit, re.MULTILINE)
    assert re.search(r"^StartLimitIntervalSec=\d+$", unit, re.MULTILINE)


def test_crash_loop_brake_is_in_the_unit_section(unit):
    """systemd v230'dan beri bu iki ayar [Unit] bölümüne aittir.

    [Service] altında yazılırlarsa systemd onları YOK SAYAR (yalnızca bir uyarı
    basar) ve fren hiç devreye girmez.
    """
    unit_section = re.split(r"^\[Service\]$", unit, flags=re.MULTILINE)[0]
    assert "StartLimitBurst" in unit_section
    assert "StartLimitIntervalSec" in unit_section


def test_install_and_unit_agree_on_the_service_name(install_sh, unit):
    """Betiğin enable ettiği isim, dosyanın adı olmalı."""
    assert f'SERVICE_NAME="{UNIT.name}"' in install_sh


# --- uninstall.sh ----------------------------------------------------------


@pytest.mark.parametrize("directory", ["/opt/tracebox", "/etc/tracebox", "/var/lib/tracebox"])
def test_uninstall_removes_every_directory_install_creates(uninstall_sh, directory):
    """Kaldırma eksik kalırsa anahtar (config.toml) makinede kalır.

    `delete` komutu da bu betiği çağırır: kullanıcı cihazı sildiğinde sırrın
    diskte kalmaması gerekir.
    """
    assert re.search(rf'="{re.escape(directory)}"', uninstall_sh), (
        f"{directory} silinenler arasında değil"
    )


def test_uninstall_stops_the_service_before_deleting_files(uninstall_sh):
    """Dosyalar önce silinirse çalışan agent hata döngüsüne girer.

    `disable --now` iki işi birden yapar: servisi durdurur ve açılışta
    başlamasını engeller.
    """
    stop = re.search(r"systemctl (disable --now|stop)", uninstall_sh)
    remove = re.search(r"^\s*rm -rf ", uninstall_sh, re.MULTILINE)

    assert stop, "servisi durduran bir systemctl çağrısı yok"
    assert remove, "dizinleri silen bir rm çağrısı yok"
    assert stop.start() < remove.start()


def test_uninstall_removes_the_service_user(uninstall_sh):
    """Geride yetim bir sistem kullanıcısı bırakılmamalı."""
    assert "userdel" in uninstall_sh


# --- delete komutunun root tarafı ------------------------------------------
# Agent yetkisiz çalışır: /opt, /etc ve systemd ona kapalı. Bu yüzden `delete`
# komutunu uygularken yalnızca state dizinine bir işaret dosyası bırakır;
# kaldırmayı root tarafında bekleyen path unit üstlenir. Zincir üç halkadan
# oluşur (agent → işaret → path unit → uninstall.sh) ve her halka ayrı bir
# dosyada durduğu için sessizce kopabilir.


def test_the_watcher_looks_at_the_path_the_agent_actually_writes(path_unit):
    """Bu dosyadaki en kritik testlerden biri.

    İzlenen yol ile agent'ın yazdığı yol AYNI olmalı. Biri değişip diğeri
    kalırsa hiçbir hata görünmez: agent işaretini bırakır, path unit başka bir
    dosyayı bekler ve kaldırma hiç başlamaz. Cihaz sunucudan silinmiş olur ama
    servis makinede çalışmaya devam eder.
    """
    expected = DEFAULT_STATE_DIR / DELETED_FILENAME

    assert re.search(rf"^PathExists={re.escape(str(expected))}$", path_unit, re.MULTILINE), (
        f"path unit {expected} yolunu izlemiyor"
    )


def test_the_watcher_catches_a_marker_that_is_already_there(path_unit):
    """`PathExists`, `PathChanged` değil.

    PathChanged yalnızca dosya OLUŞTUĞU anda tetiklenir. Agent işaretini
    bıraktıktan hemen sonra makine kapanırsa (ya da o an path unit çalışmıyorsa)
    tetikleme kaçar ve kaldırma bir daha hiç yapılmaz. PathExists zaten duran
    dosyayı da görür: kaldırma en geç bir sonraki açılışta tamamlanır.
    """
    assert re.search(r"^PathExists=", path_unit, re.MULTILINE)
    assert not re.search(r"^PathChanged=", path_unit, re.MULTILINE)


def test_the_watcher_triggers_the_uninstall_unit(path_unit):
    """Zincirin ikinci halkası: path unit hangi birimi çalıştıracak?"""
    assert re.search(rf"^Unit={re.escape(UNINSTALL_UNIT.name)}$", path_unit, re.MULTILINE)


def test_the_watcher_starts_at_boot(path_unit):
    """[Install] bölümü olmayan bir path unit `enable` EDİLEMEZ.

    Edilemezse yeniden başlatmadan sonra izleyici hiç ayağa kalkmaz ve o
    aradaki bir `delete` komutu sonsuza kadar yarım kalır.
    """
    assert re.search(r"^WantedBy=multi-user\.target$", path_unit, re.MULTILINE)


def test_the_uninstall_unit_runs_the_script_without_asking(uninstall_unit):
    """Kaldırma servisi soru soramaz: karşısında terminal yok.

    `--yes` düşerse betik onay bekler, oneshot birim yanıtsız takılır ve
    kaldırma tamamlanmaz.
    """
    exec_start = re.search(r"^ExecStart=(.+)$", uninstall_unit, re.MULTILINE)

    assert exec_start, "ExecStart yok"
    assert exec_start.group(1) == "/opt/tracebox/uninstall.sh --yes"


def test_the_uninstall_unit_runs_as_root(uninstall_unit):
    """Bu birim BİLEREK root çalışır — istisna burada, agent'ta değil.

    `User=tracebox` eklenirse kaldırma sessizce başarısız olur: systemctl,
    /etc ve /opt o kullanıcıya kapalıdır. Testin işi, istisnanın yalnızca bu
    dosyada kaldığını ve agent'ın kendi biriminin yetkisiz kalmaya devam
    ettiğini (test_service_does_not_run_as_root) ayrı ayrı tutmaktır.
    """
    assert not re.search(r"^User=", uninstall_unit, re.MULTILINE)


def test_the_uninstall_unit_is_separate_from_the_agent_unit(unit):
    """Kaldırma agent'ın kendi biriminden çalıştırılamaz.

    Çalıştırılsaydı betiğin ilk işi olan `systemctl disable --now
    tracebox-agent.service` betiği kendi cgroup'uyla birlikte öldürür ve
    kaldırma daha ilk adımda yarıda kalırdı.
    """
    assert "uninstall.sh" not in code(unit)


def test_install_puts_both_uninstall_units_in_place(install_sh):
    """Kurulum bu iki dosyayı /etc/systemd/system'e koymazsa zincir hiç kurulmaz."""
    body = code(install_sh)

    for variable, unit_file in (
        ("UNINSTALL_SERVICE", UNINSTALL_UNIT),
        ("UNINSTALL_PATH_UNIT", PATH_UNIT),
    ):
        # Betiğin adlandırdığı dosya, repodaki dosyanın kendisi olmalı: birim
        # yeniden adlandırılıp betik güncellenmezse kurulum var olmayan bir
        # dosyayı kopyalamaya çalışır.
        assert f'{variable}="{unit_file.name}"' in body, f"{unit_file.name} adı betikte yok"
        assert f'{variable}_PATH="/etc/systemd/system/${{{variable}}}"' in body
        assert re.search(
            rf'install -m 644 "\$\{{INSTALL_DIR\}}/agent/\$\{{{variable}\}}" '
            rf'"\$\{{{variable}_PATH\}}"',
            body,
        ), f"{unit_file.name} kurulmuyor"

    assert 'enable --now "${UNINSTALL_PATH_UNIT}"' in body, "path unit etkinleştirilmiyor"


def test_install_clears_a_leftover_marker_before_starting_the_watcher(install_sh):
    """İkinci en kritik test.

    Önceki kurulum `delete` ile bittiyse geride kaldırma işareti kalmış olabilir.
    İzleyici o dosya dururken etkinleştirilirse yeni kurulum, daha ilk saniyede
    kendini kaldırır — kullanıcının anahtarı da beraberinde gider.
    """
    body = code(install_sh)
    remove_index = body.index('rm -f "${DELETED_MARKER}"')
    enable_index = body.index('enable --now "${UNINSTALL_PATH_UNIT}"')

    assert remove_index < enable_index, "izleyici, eski işaret silinmeden başlatılıyor"


def test_uninstall_removes_both_uninstall_units(uninstall_sh):
    """Geride yetim unit dosyası kalmamalı; sonraki kurulum onları yeniler."""
    body = code(uninstall_sh)

    assert "${UNINSTALL_PATH_UNIT_PATH}" in body
    assert "${UNINSTALL_SERVICE_PATH}" in body


def test_uninstall_does_not_stop_the_unit_that_is_running_it(uninstall_sh):
    """En sinsi hata burada olurdu.

    Betik çoğu zaman tracebox-uninstall.service tarafından çalıştırılır. O birimi
    durdurmak (`stop` ya da `disable --now`) kendi süreç ağacını öldürmek
    demektir: kaldırma tam ortasında kesilir, makinede yarım silinmiş bir
    kurulum kalır. İzleyici (path unit) durdurulabilir — betiği o çalıştırmıyor.
    """
    body = code(uninstall_sh)

    assert not re.search(r"systemctl (stop|disable --now) .*UNINSTALL_SERVICE", body), (
        "betik kendini çalıştıran birimi durduruyor"
    )
    assert re.search(r'systemctl disable --now "\$\{UNINSTALL_PATH_UNIT\}"', body), (
        "izleyici kapatılmıyor"
    )
