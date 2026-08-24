"""
agent/core/config.py — config.toml'un izin denetimi.

config.toml, cihaz anahtarının DÜZ halini tutan tek dosyadır; sunucuda yalnızca
SHA-256 özeti vardır. Dosyayı okuyabilen, cihazı taklit edebilir.

Denetimin iki yüzü var ve ikisi de kolayca yanlış tarafa kayar:
gevşek izin fark edilmezse sır sessizce açıkta kalır; fark edilip agent
durdurulursa makine tamamen gözsüz kalır. Buradaki testler her iki kaymayı da
tutar.
"""

from __future__ import annotations

import os
import stat

import pytest

from agent.core.config import ConfigLoader, check_permissions

CONFIG_BODY = """
collector_url = "https://collector.example"
device_key    = "tbx_live_cok_gizli_anahtar"
"""

DEVICE_KEY = "tbx_live_cok_gizli_anahtar"

SECURE_MODE = 0o600


@pytest.fixture
def config_file(tmp_path):
    """Geçerli içerikli, 600 izinli bir config.toml."""
    path = tmp_path / "config.toml"
    path.write_text(CONFIG_BODY)
    path.chmod(SECURE_MODE)
    return path


class Warnings(list):
    """`warn` yerine geçer; basılan uyarıları toplar."""

    def __call__(self, message: str) -> None:
        self.append(message)


def mode_of(path) -> int:
    return path.stat().st_mode


# --- check_permissions -----------------------------------------------------


def test_owner_only_permissions_are_accepted(config_file):
    """600 doğru ayardır; uyarı çıkmamalı, yoksa uyarı anlamını yitirir."""
    warnings = Warnings()
    assert check_permissions(config_file, mode_of(config_file), warn=warnings) is True
    assert warnings == []


@pytest.mark.parametrize(
    "mode",
    [0o640, 0o644, 0o604, 0o660, 0o606, 0o666, 0o610, 0o601, 0o777],
    ids=lambda m: oct(m),
)
def test_any_access_beyond_the_owner_is_flagged(config_file, mode):
    """Bu dosyadaki en kritik test.

    Denetim yalnızca "diğerleri" (other) bitlerine baksaydı 640 temiz görünürdü
    — ama makinedeki bir GRUP üyesi anahtarı okuyabilirdi. Yalnızca okuma
    bitine baksaydı 620 temiz görünürdü; yazma da bir saldırı yoludur (anahtarı
    saldırganın kendi anahtarıyla değiştirmek).

    Sahibi dışında herhangi biri için herhangi bir bit açıksa dosya güvensizdir.
    """
    config_file.chmod(mode)
    warnings = Warnings()

    assert check_permissions(config_file, mode_of(config_file), warn=warnings) is False
    assert len(warnings) == 1


def test_warning_tells_the_user_how_to_fix_it(config_file):
    """Uyarı hem hangi dosyayı hem de düzeltme komutunu içermeli.

    "izinler fazla açık" tek başına, kullanıcının ne yapacağını bilmediği bir
    uyarıdır ve göz ardı edilir.
    """
    config_file.chmod(0o644)
    warnings = Warnings()
    check_permissions(config_file, mode_of(config_file), warn=warnings)

    assert str(config_file) in warnings[0]
    assert "chmod 600" in warnings[0]


def test_warning_does_not_contain_the_key(config_file):
    """Uyarı journald'a düşer ve journald'ı bu makinedeki başkaları okuyabilir.

    Sırrı, sırrın açıkta olduğunu söyleyen mesajın içine koymak açığı
    büyütürdü.
    """
    config_file.chmod(0o644)
    warnings = Warnings()
    check_permissions(config_file, mode_of(config_file), warn=warnings)

    assert DEVICE_KEY not in warnings[0]


# --- Yükleyicinin davranışı ------------------------------------------------


def test_loose_permissions_do_not_stop_the_agent(config_file):
    """Denetim uyarır, ÖLDÜRMEZ.

    ConfigError yükselseydi agent açılamaz, systemd 5 denemede pes eder ve
    makine tamamen izlenemez hale gelirdi — bir izin bitinin yaratacağından çok
    daha büyük bir zarar.
    """
    config_file.chmod(0o644)
    warnings = Warnings()

    config = ConfigLoader(config_file, warn=warnings).load()

    assert config.device_key == DEVICE_KEY
    assert any("chmod 600" in message for message in warnings)


def test_secure_file_is_loaded_without_any_warning(config_file):
    """Doğru kurulmuş bir sistem sessiz olmalı."""
    warnings = Warnings()
    ConfigLoader(config_file, warn=warnings).load()
    assert warnings == []


def test_permission_warning_is_not_repeated_every_tick(config_file):
    """Döngü saniyede bir load() çağırır.

    Uyarı her çağrıda basılsaydı journald dolar, gerçek olaylar arasında
    kaybolurdu. Dosya değişmediyse denetim de tekrarlanmaz.
    """
    config_file.chmod(0o644)
    warnings = Warnings()
    loader = ConfigLoader(config_file, warn=warnings)

    for _ in range(10):
        loader.load()

    assert len(warnings) == 1


def test_permissions_loosened_after_startup_are_noticed(config_file):
    """İkinci en kritik test — M5'te kapatılan boşluk.

    `chmod` dosyanın ne mtime'ını ne boyutunu değiştirir. Önbellek imzası
    yalnızca bu ikisine bakarsa, açılışta 600 olan bir dosya sonradan 644
    yapıldığında agent bunu ÖMÜR BOYU fark etmez: sır açığa çıkar ve tek
    bekçisi olan uyarı hiç basılmaz.
    """
    warnings = Warnings()
    loader = ConfigLoader(config_file, warn=warnings)

    loader.load()
    assert warnings == []

    config_file.chmod(0o644)
    loader.load()

    assert any("chmod 600" in message for message in warnings)


def test_tightening_permissions_clears_the_warning(config_file):
    """Kullanıcı düzeltince uyarı susmalı — yoksa düzeltmenin işe yaradığı
    anlaşılmaz ve uyarı gürültüye dönüşür."""
    config_file.chmod(0o644)
    warnings = Warnings()
    loader = ConfigLoader(config_file, warn=warnings)
    loader.load()

    config_file.chmod(SECURE_MODE)
    loader.load()
    before = len(warnings)
    loader.load()

    assert len(warnings) == before


@pytest.mark.skipif(os.geteuid() == 0, reason="root her dosyayı okur, izin denetimi bypass edilir")
def test_unreadable_file_is_a_startup_error(config_file):
    """Hiç okunamayan config, uyarı değil hatadır.

    Agent'ın yanlış/eksik ayarla açılmaması gerekir: adressiz bir agent veriyi
    hiçbir yere gönderemez ama "çalışıyor" görünür.
    """
    from agent.core.config import ConfigError

    config_file.chmod(0o000)
    with pytest.raises(ConfigError):
        ConfigLoader(config_file, warn=Warnings()).load()
