"""
agent/__main__.py — açılış kararları.

Giriş noktası iş yapmaz, yalnızca "çalışılsın mı, çalışılmasın mı"ya karar
verir. Buradaki tek soru silinmiş cihazla ilgili: `delete` komutu uygulanmış
bir makinede agent bir daha AÇILMAMALIDIR.

Açılırsa görünürde bir hata olmaz — ve sorun tam olarak budur: cihaz kaydı
sunucudan silindiği için anahtar artık geçersizdir, süreç her poll'da 401 alan
bir hayalete dönüşür ve journald'ı sonsuza kadar hata satırlarıyla doldurur.
"""

from __future__ import annotations

import agent.__main__ as entrypoint
from agent.core.state import StateStore

CONFIG_BODY = """
collector_url = "https://collector.example"
device_key    = "tbx_live_test"
"""


def prepare(tmp_path, monkeypatch):
    """Geçerli bir config ve boş bir state dizini kurar."""
    config_path = tmp_path / "config.toml"
    config_path.write_text(CONFIG_BODY)
    config_path.chmod(0o600)

    state_dir = tmp_path / "state"
    state_dir.mkdir()

    monkeypatch.setenv("TRACEBOX_CONFIG", str(config_path))
    monkeypatch.setenv("TRACEBOX_STATE_DIR", str(state_dir))
    return state_dir


def test_a_deleted_device_does_not_start_the_loop(tmp_path, monkeypatch, capsys):
    """İşaret dosyası duruyorsa döngüye hiç girilmez."""
    state_dir = prepare(tmp_path, monkeypatch)
    StateStore(state_dir).mark_deleted()

    started = []
    monkeypatch.setattr(entrypoint.loop, "run", lambda *args: started.append(args))

    exit_code = entrypoint.main([])

    assert started == [], "silinmiş cihazda döngü başlatıldı"
    assert "silindi" in capsys.readouterr().out


def test_a_deleted_device_exits_without_asking_for_a_restart(tmp_path, monkeypatch, capsys):
    """Çıkış kodu SIFIR olmalı.

    Servis `Restart=on-failure` ile çalışır: sıfırdan farklı her kod systemd'yi
    yeniden başlatmaya çağırır. Silinmiş cihazda bu, saniyede bir açılıp kapanan
    bir döngü demektir — ta ki çökme freni servisi `failed` bırakana kadar.
    """
    state_dir = prepare(tmp_path, monkeypatch)
    StateStore(state_dir).mark_deleted()
    monkeypatch.setattr(entrypoint.loop, "run", lambda *args: None)

    assert entrypoint.main([]) == entrypoint.EXIT_OK


def test_a_normal_device_still_starts(tmp_path, monkeypatch, capsys):
    """İşaret yoksa açılış olağan yolundan devam eder.

    Kontrolün fazla geniş yazılması (örneğin state dizininin varlığına bakmak)
    her agent'ı kalıcı olarak durdururdu; bu test o kaymayı tutar.
    """
    prepare(tmp_path, monkeypatch)

    started = []
    monkeypatch.setattr(entrypoint.loop, "run", lambda *args: started.append(args))

    assert entrypoint.main([]) == entrypoint.EXIT_OK
    assert len(started) == 1
