"""
Varsayılan ayarların DÖRT kopyası birbirini tutuyor mu?

Her ayar bugün dört ayrı yerde yazılı:

  1. `Config` dataclass'ının alan varsayılanı        — agent/core/config.py
  2. `_parse()`in `_positive_int(..., N)` yedeği      — agent/core/config.py
  3. `config.example.toml`                            — kullanıcının okuduğu belge
  4. `install.sh`in yazdığı config.toml               — kullanıcının GERÇEKTEN aldığı dosya

Neden dört: (1) kod yolu için, (2) config'te alan hiç yoksa diye, (3) belgelemek
için, (4) kurulumda dosyayı üretmek için. Hiçbiri diğerini okuyamaz — biri TOML,
biri bash heredoc'u, ikisi Python.

Bu testin sebebi somut: 2026-08-31'de `flush_cooldown_seconds` 20'den 10'a
indirildi ve DÖRDÜNÜN de elle düzeltilmesi gerekti. Biri unutulsaydı hiçbir şey
kırılmazdı — kurulan makine belgede yazandan farklı davranır, fark ancak aylar
sonra "neden bu makine öbürü gibi davranmıyor" diye bakarken görülürdü.

Testler değerlerin NE olduğunu iddia etmiyor; yalnızca dördünün AYNI olduğunu
iddia ediyor. Değeri değiştirmek serbest, tek bir yerde değiştirmek değil.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import fields
from pathlib import Path

import pytest

from agent.core import config as config_module
from agent.core.config import MIN_SEND_INTERVAL_SECONDS, Config

AGENT_DIR = Path(__file__).resolve().parent.parent / "agent"
EXAMPLE = AGENT_DIR / "config.example.toml"
INSTALL = AGENT_DIR / "install.sh"

# Bağlantı alanlarının varsayılanı YOK ve olmamalı: ikisi de makineye özgü.
# Karşılaştırma dışında tutuluyorlar, yoksa örnek dosyadaki yer tutucu anahtar
# ile install.sh'in `${DEVICE_KEY}` değişkeni karşılaştırılmaya çalışılırdı.
CONNECTION_KEYS = {"collector_url", "device_key"}

DEFAULTS: dict[str, object] = {
    field.name: field.default
    for field in fields(Config)
    if field.name not in CONNECTION_KEYS
}


def example_toml() -> dict:
    return tomllib.loads(EXAMPLE.read_text(encoding="utf-8"))


def install_toml() -> dict:
    """install.sh'in ürettiği config.toml'u ayrıştırır.

    Betik çalıştırılmıyor: heredoc gövdesi metinden çıkarılıp kabuk değişkenleri
    yer tutucularla değiştiriliyor. Amaç betiği test etmek değil, YAZDIĞI
    dosyanın içeriğini görmek.
    """
    body = INSTALL.read_text(encoding="utf-8")
    match = re.search(r"<<TOML\n(.*?)\nTOML\n", body, re.DOTALL)
    assert match, "install.sh içinde config.toml heredoc'u bulunamadı"

    filled = re.sub(r"\$\{[A-Z_]+\}", "placeholder", match.group(1))
    return tomllib.loads(filled)


# --- 1 ↔ 2: dataclass varsayılanı ile _parse'ın yedeği --------------------


def test_parse_falls_back_to_the_dataclass_defaults():
    """Config'te HİÇBİR isteğe bağlı alan yokken kod varsayılanları çıkmalı.

    `_parse` her alan için kendi yedeğini ayrı ayrı yazıyor. Biri dataclass'taki
    değerden ayrılırsa, ayarı config'ine yazmayan kullanıcı ile alanı silen
    kullanıcı farklı davranan iki agent alırdı.
    """
    parsed = config_module._parse(
        {"collector_url": "https://example.test", "device_key": "tbx_live_x"},
        warn=lambda message: pytest.fail(f"beklenmeyen uyarı: {message}"),
    )

    for name, expected in DEFAULTS.items():
        assert getattr(parsed, name) == expected, f"_parse yedeği ayrıştı: {name}"


# --- 3 ↔ 1 ve 4 ↔ 1: iki belge ile kod ------------------------------------


@pytest.mark.parametrize("name,expected", sorted(DEFAULTS.items(), key=lambda kv: kv[0]))
@pytest.mark.parametrize(
    "document",
    [pytest.param(example_toml, id="config.example.toml"), pytest.param(install_toml, id="install.sh")],
)
def test_shipped_config_matches_the_code_default(document, name, expected):
    values = document()
    assert name in values, f"'{name}' bu dosyada hiç yok"

    actual = values[name]
    if isinstance(expected, tuple):
        actual = tuple(actual)

    assert actual == expected, f"'{name}' koddaki varsayılandan farklı"


@pytest.mark.parametrize(
    "document",
    [pytest.param(example_toml, id="config.example.toml"), pytest.param(install_toml, id="install.sh")],
)
def test_shipped_config_has_no_unknown_keys(document):
    """Belgede kodun tanımadığı bir ayar olmamalı.

    Yeniden adlandırılan bir alan buradan yakalanır: kod yeni adı okur, dosya
    eski adı taşır, agent sessizce varsayılana düşer.
    """
    known = {field.name for field in fields(Config)}
    unknown = sorted(set(document()) - known)
    assert not unknown, f"kodda karşılığı olmayan ayar(lar): {unknown}"


# --- gönderim aralığının alt sınırı ---------------------------------------


def test_shipped_send_interval_is_not_below_the_floor():
    """Dağıttığımız dosyalar kendi alt sınırımızı ihlal etmemeli.

    Etseydi agent daha ilk açılışta kendi örnek dosyası için uyarı basar ve
    değeri sessizce yükseltirdi — kullanıcının okuduğu sayı ile makinenin
    kullandığı sayı ayrışırdı.
    """
    assert Config.send_interval_seconds >= MIN_SEND_INTERVAL_SECONDS
    for document in (example_toml, install_toml):
        assert document()["send_interval_seconds"] >= MIN_SEND_INTERVAL_SECONDS
