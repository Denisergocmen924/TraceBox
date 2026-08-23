"""
Katman testi — çekirdek kodun hangi işletim sisteminde çalıştığını bilmemesi.

CLAUDE.md §7'nin kuralı: "Çekirdek journald'ı hiç import etmez; sadece
LogSource arayüzünü çağırır." Bu bir yorum satırı olarak kalırsa ilk acele
düzeltmede sessizce bozulur — tek bir `from ... import JournaldSource` yeter.
Test kuralı yürürlüğe koyar.

Kural neden var: Windows desteği (ya da journald'ın yerine geçecek başka bir
kaynak) geldiğinde değişmesi gereken dosya sayısı BİR olsun — bileşim kökü
(agent/__main__.py). Çekirdek bağımlıysa değişiklik döngüye kadar yayılır.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

CORE_DIR = Path(__file__).resolve().parent.parent / "agent" / "core"
ENTRY_POINT = Path(__file__).resolve().parent.parent / "agent" / "__main__.py"

# Çekirdeğin logsources altında görmesine izin verilen tek modül: sözleşme.
ALLOWED_LOGSOURCE_MODULE = "agent.logsources.base"

# Platforma özgü olduğu için çekirdekte hiç görünmemesi gereken adlar.
FORBIDDEN_FRAGMENTS = ("journald", "systemd", "winevt", "evtlog")


def imported_modules(path: Path) -> set[str]:
    """Dosyanın import ettiği modül adları (import X ve from X import Y)."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)

    return names


CORE_FILES = sorted(CORE_DIR.glob("*.py"))


def test_core_files_were_found():
    """Dosya listesi boş kalırsa aşağıdaki testler hiçbir şeyi kontrol etmeden geçerdi."""
    assert len(CORE_FILES) >= 5


@pytest.mark.parametrize("path", CORE_FILES, ids=lambda p: p.name)
def test_core_imports_only_the_contract(path: Path):
    """Çekirdek, logsources altından yalnızca base'i import edebilir."""
    logsource_imports = {
        module for module in imported_modules(path) if module.startswith("agent.logsources")
    }

    assert logsource_imports <= {ALLOWED_LOGSOURCE_MODULE}, (
        f"{path.name} sözleşme dışı bir log kaynağı import ediyor: "
        f"{sorted(logsource_imports - {ALLOWED_LOGSOURCE_MODULE})}"
    )


@pytest.mark.parametrize("path", CORE_FILES, ids=lambda p: p.name)
def test_core_imports_nothing_platform_specific(path: Path):
    """Çekirdekte platforma özgü hiçbir modül adı geçmez."""
    suspicious = [
        module
        for module in imported_modules(path)
        for fragment in FORBIDDEN_FRAGMENTS
        if fragment in module.lower()
    ]

    assert not suspicious, f"{path.name} platforma özgü modül import ediyor: {suspicious}"


def test_the_entry_point_is_the_one_place_that_chooses():
    """Implementasyon seçimi bileşim kökündedir.

    Bu testin ters yönü de önemli: kural "hiç kimse journald'ı import etmesin"
    değil, "yalnızca TEK bir yer etsin". Burası boşalırsa agent hiçbir log
    kaynağıyla çalışmıyor demektir.
    """
    assert "agent.logsources.linux_journald" in imported_modules(ENTRY_POINT)
