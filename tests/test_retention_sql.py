"""
db/retention.sql — sözleşme testleri.

Bu dosya bir birim testinde ÇALIŞTIRILAMAZ: pg_cron uzantısı ve canlı bir
Postgres ister; test ortamında ikisi de yok. Doğru çalıştığı Supabase'de elle
doğrulanır.

Buradaki testler farklı bir soruya bakar: dosya SÖZLEŞMESİNİ hâlâ tutuyor mu?

Retention'ın bozulma biçimi sessizdir — hiçbir hata üretmez:
  * bir tablo listeden düşerse o tablo sonsuza kadar birikir,
  * ölçüt measured_at'e kayarsa silme kararını cihaz verir,
  * status süzgeci düşerse teslim edilmemiş komutlar yok olur,
  * bir DELETE $$ bloğunun dışına taşarsa gece değil, yalnızca kurulumda çalışır.

Dördünde de sistem "başarılı" der. Kaybı fark eden başka hiçbir şey yok.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

RETENTION = Path(__file__).resolve().parent.parent / "db" / "retention.sql"

# Gece silinen dört veri tablosu. Listeden düşen tablo sessizce birikmeye başlar.
DATA_TABLES = ["metrics", "logs", "crash_snapshots", "commands"]

# Sunucunun yazdığı damgayı taşıyan üç tablo. commands'ta received_at yoktur;
# onun karşılığı created_at'tir ve ayrıca test edilir.
SERVER_STAMPED_TABLES = ["metrics", "logs", "crash_snapshots"]

JOB_NAME = "tracebox_retention"


def code(body: str) -> str:
    """SQL yorumlarını atar.

    Yorumlar bu dosyada iddiaların hepsini kelime kelime anlatıyor — süzgeç
    olmadan `status = 'applied'` koddan silinse bile testler yeşil kalırdı.
    Satır içi `--`'den sonrası da atılır.
    """
    return "\n".join(line.split("--")[0] for line in body.splitlines())


@pytest.fixture(scope="module")
def sql() -> str:
    """Yorumları ayıklanmış dosya içeriği."""
    return code(RETENTION.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def job_body(sql: str) -> str:
    """cron.schedule'a geçilen $$ ... $$ bloğunun içi.

    Gece tekrar tekrar çalışan SQL yalnızca burasıdır. Blok dışına düşen bir
    ifade dosya çalıştırıldığında BİR KEZ koşar, sonra bir daha asla.
    """
    match = re.search(r"\$\$(.*?)\$\$", sql, re.DOTALL)
    assert match, "cron.schedule'ın $$ ... $$ gövdesi bulunamadı"
    return match.group(1)


def delete_statement(body: str, table: str) -> str:
    """Bir tablonun DELETE ifadesini `delete from`'dan `;`'e kadar döndürür."""
    match = re.search(rf"delete\s+from\s+public\.{table}\b.*?;", body, re.DOTALL)
    assert match, f"{table} için DELETE ifadesi bulunamadı"
    return match.group(0)


# --- Dosyanın kendisi ------------------------------------------------------


def test_file_exists():
    """retention.sql, verinin silinmesini sağlayan TEK dosya; eksikse hiçbir şey silinmez."""
    assert RETENTION.is_file()


# --- Hangi tablolar siliniyor ----------------------------------------------


@pytest.mark.parametrize("table", DATA_TABLES)
def test_every_data_table_is_cleaned(job_body, table):
    """Dört veri tablosunun dördü de gece işinde silinmeli.

    Biri listeden düşerse hata çıkmaz; o tablo yalnızca büyümeye devam eder.
    """
    assert re.search(rf"delete\s+from\s+public\.{table}\b", job_body)


@pytest.mark.parametrize("table", DATA_TABLES)
def test_every_delete_lives_inside_the_scheduled_block(sql, job_body, table):
    """DELETE'ler $$ bloğunun İÇİNDE olmalı — dışarı taşan ifade yalnızca bir kez koşar."""
    statement = delete_statement(sql, table)
    assert statement in job_body


# --- Silme ölçütü ----------------------------------------------------------


@pytest.mark.parametrize("table", SERVER_STAMPED_TABLES)
def test_criterion_is_the_server_written_timestamp(job_body, table):
    """metrics/logs/crash_snapshots received_at'e bakar — sunucunun yazdığı damgaya."""
    assert re.search(r"received_at\s*<", delete_statement(job_body, table))


def test_measured_at_is_never_a_deletion_criterion(job_body):
    """measured_at'i AGENT yazar.

    Ölçüt oraya kayarsa satırın silinip silinmeyeceğine veriyi gönderen cihaz
    karar verir: damgayı geleceğe yazan bir cihazın verisi asla eskimez.
    """
    assert "measured_at" not in job_body


def test_commands_is_measured_by_created_at(job_body):
    """commands'ta received_at sütunu yok; sunucu damgası created_at'tir."""
    assert re.search(r"created_at\s*<", delete_statement(job_body, "commands"))


# --- pending komutların korunması ------------------------------------------


def test_only_applied_commands_are_deleted(job_body):
    """'pending' satır teslim EDİLMEMİŞ bir emirdir; yaşı ne olursa olsun silinmez.

    Süzgeç düşerse çevrimdışı bir cihaza verilen delete/pause komutu, cihaz
    geri dönmeden önce yok olur — ve hiçbir yerde hata üretilmez.
    """
    statement = delete_statement(job_body, "commands")
    assert re.search(r"status\s*=\s*'applied'", statement)


# --- Politikanın hesap başına uygulanması ----------------------------------


@pytest.mark.parametrize("table", DATA_TABLES)
def test_age_limit_comes_from_the_owning_account(job_body, table):
    """Süre sabit değil, satırın SAHİBİNİN retention_days politikasından gelir.

    Sabit bir süre bugün doğru sonucu verir (tüm hesaplar varsayılan 10 gün),
    yarın farklı politikalı bir hesap eklendiğinde sessizce yanlış olur.
    """
    statement = delete_statement(job_body, table)
    assert re.search(r"using\s+public\.accounts\s+a\b", statement)
    assert "a.retention_days" in statement


@pytest.mark.parametrize("table", DATA_TABLES)
def test_rows_are_matched_to_their_own_account(job_body, table):
    """Join şartı olmadan `using` çapraz birleşime döner: her satır her hesapla eşleşir."""
    assert re.search(r"account_id\s*=\s*a\.id", delete_statement(job_body, table))


# --- Zamanlama -------------------------------------------------------------


def test_job_runs_every_night_at_midnight(sql):
    """'0 0 * * *' — dakika 0, saat 0, her gün. Geçerli ama yanlış bir ifade sessizdir."""
    assert re.search(r"cron\.schedule\(\s*'[^']+'\s*,\s*'0 0 \* \* \*'", sql)


def test_job_name_is_the_same_in_schedule_and_verification(sql):
    """İşin adı pg_cron'un tekillik anahtarıdır.

    Aynı adla yeniden çalıştırmak mevcut işi günceller; ad kayarsa eskisi
    silinmeden İKİNCİ bir iş kurulur ve dosyanın sonundaki doğrulama sorgusu
    yanlış işe bakar.
    """
    assert re.search(rf"cron\.schedule\(\s*'{JOB_NAME}'", sql)
    assert re.search(rf"from\s+cron\.job\s+where\s+jobname\s*=\s*'{JOB_NAME}'", sql, re.DOTALL)
