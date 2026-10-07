"""
db/migrations/0006_metrics_buckets_addons.sql — eklenti sütunlarının sözleşmesi.

Genel güvenlik sözleşmesi (INVOKER, search_path, revoke/grant) test_metrics_buckets_sql.py'de;
burada yalnızca 0006'nın eklediği şey korunuyor: her eklenti ölçüsü min / max / avg üçlüsüyle
dönmeli ve migration ile schema.sql aynı sütun kümesini söylemeli.
"""
import re
from pathlib import Path

import pytest

DB = Path(__file__).resolve().parent.parent / "db"
MIGRATION = DB / "migrations" / "0006_metrics_buckets_addons.sql"
SCHEMA = DB / "schema.sql"

# metrics sütunu → fonksiyonun çıkış adı öneki
ADDON_MEASURES = {
    "temperature_c": "temp",
    "swap_used_mb": "swap",
    "load_avg_1": "load1",
    "load_avg_5": "load5",
    "load_avg_15": "load15",
    "gpu_usage_percent": "gpu_usage",
    "gpu_vram_used_mb": "gpu_vram",
}
AGGREGATES = ["min", "max", "avg"]
FILES = [MIGRATION, SCHEMA]


def code(path: Path) -> str:
    """Yorum satırları atılmış metin: bir iddia yorumla tatmin olmasın."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return "\n".join(re.sub(r"--.*", "", line) for line in lines)


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
@pytest.mark.parametrize("column", ADDON_MEASURES)
@pytest.mark.parametrize("aggregate", AGGREGATES)
def test_every_addon_measure_reports_min_max_and_avg(path, column, aggregate):
    prefix = ADDON_MEASURES[column]
    pattern = rf"{aggregate}\s*\(\s*m\.{column}\s*\)(::real)?\s+as\s+{prefix}_{aggregate}\b"
    assert re.search(pattern, code(path))


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
@pytest.mark.parametrize("prefix", ADDON_MEASURES.values())
@pytest.mark.parametrize("aggregate", AGGREGATES)
def test_every_addon_output_column_is_declared(path, prefix, aggregate):
    assert re.search(rf"^\s*{prefix}_{aggregate}\s+(real|int)\b", code(path), re.M)


def test_migration_and_schema_declare_the_same_addon_columns():
    def declared(path: Path) -> set[str]:
        names = "|".join(re.escape(p) for p in ADDON_MEASURES.values())
        return set(re.findall(rf"^\s*((?:{names})_(?:min|max|avg))\s", code(path), re.M))

    assert declared(MIGRATION) == declared(SCHEMA)
    assert len(declared(MIGRATION)) == 21


def test_migration_expects_the_new_column_count():
    assert "out_columns            = 38" in MIGRATION.read_text(encoding="utf-8")
