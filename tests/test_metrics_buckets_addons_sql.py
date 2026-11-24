"""
db/schema.sql — `metrics_buckets` eklenti sütunlarının sözleşmesi.

Genel güvenlik sözleşmesi (INVOKER, search_path, revoke/grant) test_metrics_buckets_sql.py'de;
burada yalnızca eklenti ölçüleri korunuyor: her biri min / max / avg üçlüsüyle dönmeli.
"""
import re
from pathlib import Path

import pytest

DB = Path(__file__).resolve().parent.parent / "db"
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
FILES = [SCHEMA]


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


def test_schema_declares_all_addon_columns():
    names = "|".join(re.escape(p) for p in ADDON_MEASURES.values())
    declared = set(re.findall(rf"^\s*((?:{names})_(?:min|max|avg))\s", code(SCHEMA), re.M))

    assert len(declared) == 21
