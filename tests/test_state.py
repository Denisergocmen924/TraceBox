"""
agent/core/state.py — eski sürümden kalan state.json'un okunması.
"""

from __future__ import annotations

import json

from agent.core.state import StateStore


def test_a_state_file_with_a_removed_field_still_loads(tmp_path):
    """Kaldırılmış bir alan (`applied_command_ids`) taşıyan state.json açılır.

    Eski sürümde yazılmış dosya yükseltmeden sonra da okunmalı: bilinmeyen
    anahtar düşer, bilinen alanlar korunur. Açılamasaydı agent güncellemeden
    sonra hiç başlamazdı.
    """
    path = tmp_path / "state.json"
    path.write_text(
        json.dumps({"logging_enabled": False, "applied_command_ids": ["k1", "k2"]}),
        encoding="utf-8",
    )

    state = StateStore(tmp_path).load()

    assert state.logging_enabled is False
    assert not hasattr(state, "applied_command_ids")
    assert not (tmp_path / "state.json.corrupt").exists()
