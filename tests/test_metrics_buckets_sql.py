"""
db/schema.sql ve db/rls.sql — `metrics_buckets` sözleşme testleri.

Fonksiyon burada ÇALIŞTIRILAMAZ: canlı bir Postgres ve içinde veri ister; test
ortamında ikisi de yok. Gerçekten doğru sonuç ürettiği Supabase'de, rls.sql'in
sonundaki doğrulama sorgusuyla kontrol edilir.

Buradaki testler farklı bir soruya bakar: dosya SÖZLEŞMESİNİ hâlâ tutuyor mu?

Bu fonksiyonun bozulma biçimlerinin hepsi sessizdir — grafik yine çizilir:
  * `security invoker` -> `security definer`'a kayarsa RLS atlanır ve giriş
    yapmış herhangi bir kullanıcı, rastgele bir device_id yazarak BAŞKASININ
    metriklerini okur. Ekranda hiçbir fark görünmez.
  * min/max düşer, yalnızca ortalama kalırsa 5 saniyelik CPU patlaması kovanın
    ortalamasında kaybolur. Grafik "her şey yolunda" der — oysa o patlamayı
    göstermek ürünün varlık sebebi.
  * aralık yarı açık olmaktan çıkarsa (`<` yerine `<=`) sınırdaki ölçüm iki
    komşu blokta birden sayılır.
  * kova sayısının sınırı düşerse tek bir istek milyonlarca kova üretir.
  * `search_path` sabitlenmezse fonksiyonun hangi tabloyu okuduğunu çağıran
    belirleyebilir.

Beşinde de hata çıkmaz. Fark eden başka hiçbir şey yok.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

DB = Path(__file__).resolve().parent.parent / "db"

SCHEMA = DB / "schema.sql"
RLS = DB / "rls.sql"

FUNC = "metrics_buckets"

# Grafikte çizilen üç ölçü. Her biri için üçlü (min, max, avg) birden dönmeli.
MEASURES = ["cpu_percent", "ram_used_mb", "disk_percent"]
AGGREGATES = ["min", "max", "avg"]

# revoke/grant satırlarının hedeflediği imza. Fonksiyona bir parametre eklenip
# bu liste güncellenmezse yetki satırları var olmayan bir overload'a bakar.
SIGNATURE = ["uuid", "timestamptz", "timestamptz", "int"]

# EXECUTE yetkisinin alınması gereken roller. service_role listede DEĞİL:
# collector zaten RLS'i bypass ediyor, ondan yetki almanın bir karşılığı yok.
REVOKED_ROLES = ["public", "anon"]


def code(body: str) -> str:
    """SQL yorumlarını atar.

    Yorumlar bu dosyada iddiaların hepsini kelime kelime anlatıyor — süzgeç
    olmadan `security invoker` koddan silinse bile testler yeşil kalırdı.
    """
    return "\n".join(line.split("--")[0] for line in body.splitlines())


def read(path: Path) -> str:
    return code(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rls() -> str:
    return read(RLS)


def definition(sql: str) -> str:
    """`create or replace function ... $$ ... $$;` bloğunun tamamı."""
    match = re.search(
        rf"create\s+or\s+replace\s+function\s+public\.{FUNC}\b.*?\$\$.*?\$\$\s*;",
        sql,
        re.DOTALL,
    )
    assert match, f"{FUNC} fonksiyon tanımı bulunamadı"
    return match.group(0)


def header(sql: str) -> str:
    """Tanımın gövde ÖNCESİ kısmı: imza, dönüş tipi ve fonksiyon nitelikleri."""
    return definition(sql).split("$$")[0]


def body(sql: str) -> str:
    """`$$ ... $$` arasındaki sorgunun kendisi."""
    return definition(sql).split("$$")[1]


# Fonksiyon tanımı schema.sql'de, yetki satırları rls.sql'de durur.
DEFINITION_FILES = [SCHEMA]
GRANT_FILES = [RLS]


# --- Dosyalar --------------------------------------------------------------


@pytest.mark.parametrize("path", [SCHEMA, RLS])
def test_file_exists(path):
    """Fonksiyon tanımı schema.sql'de, yetkileri rls.sql'de durur."""
    assert path.is_file()


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_function_is_defined(path):
    """Tanım schema.sql'de bulunmalı."""
    assert definition(read(path))


# --- Güvenlik: bu bölüm dosyanın en kritik kısmı ---------------------------


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_function_runs_with_the_callers_permissions(path):
    """SECURITY INVOKER: fonksiyon çağıranın yetkisiyle koşar, RLS devrede kalır.

    device_id bir PARAMETRE — yani değerini kullanıcı yazar. RLS olmasa
    başkasının cihaz id'sini yazan herkes onun metriklerini okurdu.
    """
    assert re.search(r"security\s+invoker", header(read(path)))


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_function_is_never_security_definer(path):
    """DEFINER, RLS'i atlar ve bu fonksiyonu doğrudan bir okuma kapısına çevirir.

    Ayrı bir test: `invoker` eklenmiş ama `definer` da bırakılmış bir dosyada
    Postgres sonuncuyu uygular; tek bir varlık testi bunu kaçırır.
    """
    assert not re.search(r"security\s+definer", header(read(path)))


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_search_path_is_pinned_to_empty(path):
    """`set search_path = ''` — çağıranın arama yolu fonksiyonu yönlendiremesin.

    Sabitlenmezse çağıran, kendi şemasına `metrics` adında bir tablo koyup
    fonksiyona onu okutabilir.
    """
    assert re.search(r"set\s+search_path\s*=\s*''", header(read(path)))


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_tables_are_schema_qualified(path):
    """search_path boşken nitelenmemiş bir ad ÇÖZÜLEMEZ; tablo `public.metrics` yazılmalı."""
    sql = body(read(path))
    assert re.search(r"from\s+public\.metrics\b", sql)
    assert not re.search(r"from\s+metrics\b", sql)


@pytest.mark.parametrize("path", GRANT_FILES, ids=lambda p: p.name)
@pytest.mark.parametrize("role", REVOKED_ROLES)
def test_execute_is_revoked(path, role):
    """EXECUTE yetkisi İKİ yerden geliyor; revoke ikisini de saymalı.

    public : Postgres'in yeni fonksiyonlara verdiği varsayılan yetki.
    anon   : Supabase'in default privileges ayarından gelen DOĞRUDAN grant.

    anon'u yalnızca public'ten revoke ederek kaldıramazsın — doğrudan grant
    yerinde kalır. 2026-08-30 canlı doğrulamasında tam olarak bu oldu:
    `from public` çalıştı, hata vermedi, anon_execute yine de true döndü.
    Sessiz başarısızlık: SQL yeşil, kapı açık.
    """
    match = re.search(
        rf"revoke\s+all\s+on\s+function\s+public\.{FUNC}\s*\([^)]*\)\s*from\s+([^;]+);",
        read(path),
    )
    assert match, "revoke satırı bulunamadı"
    roles = {r.strip() for r in match.group(1).split(",")}
    assert role in roles


@pytest.mark.parametrize("path", GRANT_FILES, ids=lambda p: p.name)
def test_execute_is_granted_to_authenticated(path):
    """Dashboard'ın grafiği çizebilmesi için giriş yapmış kullanıcı çağırabilmeli."""
    assert re.search(
        rf"grant\s+execute\s+on\s+function\s+public\.{FUNC}\s*\([^)]*\)\s*to\s+authenticated",
        read(path),
    )


@pytest.mark.parametrize("path", GRANT_FILES, ids=lambda p: p.name)
def test_execute_is_granted_to_nobody_else(path):
    """anon veya public'e verilen bir grant, az önce alınan yetkiyi geri verir."""
    grants = re.findall(
        rf"grant\s+execute\s+on\s+function\s+public\.{FUNC}\s*\([^)]*\)\s*to\s+(\w+)",
        read(path),
    )
    assert grants, "hiç grant bulunamadı"
    assert set(grants) == {"authenticated"}


@pytest.mark.parametrize("path", GRANT_FILES, ids=lambda p: p.name)
def test_grant_signature_matches_the_function_parameters(path):
    """Yetki satırları imzayla eşleşmeli.

    Fonksiyona parametre eklenip bu satırlar güncellenmezse revoke/grant var
    olmayan bir overload'a bakar: yetki satırı hata verir ya da yetki hiç değişmez.
    """
    signatures = re.findall(
        rf"on\s+function\s+public\.{FUNC}\s*\(([^)]*)\)", read(path)
    )
    assert signatures, "revoke/grant imzası bulunamadı"
    for raw in signatures:
        types = [t.strip() for t in raw.split(",")]
        assert types == SIGNATURE


def test_declared_parameters_match_the_grant_signature():
    """Fonksiyonun KENDİ parametre tipleri de aynı imzayı vermeli.

    Yukarıdaki test grant satırlarını sabit listeye bağlar; bu test listenin
    fonksiyonun gerçek haliyle aynı kaldığını doğrular. İkisi ayrı olmasa
    parametre eklendiğinde her şey birlikte kayar ve hiçbir test kırılmaz.
    """
    match = re.search(
        rf"function\s+public\.{FUNC}\s*\((.*?)\)\s*returns",
        read(SCHEMA),
        re.DOTALL,
    )
    assert match, "fonksiyon parametre listesi bulunamadı"
    declared = [
        param.strip().split()[1]
        for param in match.group(1).split(",")
        if param.strip()
    ]
    assert declared == SIGNATURE


# --- Grafiğin dürüstlüğü ---------------------------------------------------


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
@pytest.mark.parametrize("measure", MEASURES)
@pytest.mark.parametrize("aggregate", AGGREGATES)
def test_every_measure_reports_min_max_and_avg(path, measure, aggregate):
    """Üç ölçünün üçü de min, max VE ortalamayla dönmeli.

    Ortalama tek başına yalan söyler: 5 saniyelik bir patlama 15 dakikalık
    kovanın ortalamasında kaybolur. Yalnızca max da yalandır — makineyi
    olduğundan yoğun gösterir. Grafikte bant min-max, çizgi ortalamadır.
    """
    assert re.search(rf"{aggregate}\s*\(\s*m\.{measure}\s*\)", body(read(path)))


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_rows_are_filtered_by_device(path):
    """Cihaz süzgeci düşerse grafik hesaptaki TÜM cihazları tek çizgide toplar.

    RLS bunu engellemez: satırların hepsi çağıranın kendi hesabına aittir.
    """
    assert re.search(r"m\.device_id\s*=\s*p_device_id", body(read(path)))


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_the_time_range_is_half_open(path):
    """[p_from, p_to) — başlangıç dahil, bitiş hariç.

    İki uç da dahil olsaydı, ardışık iki blok çekildiğinde sınırdaki ölçüm
    ikisinde birden sayılırdı (§9.5 blok blok çekme).
    """
    sql = body(read(path))
    assert re.search(r"m\.measured_at\s*>=\s*p_from", sql)
    assert re.search(r"m\.measured_at\s*<\s*p_to", sql)
    assert not re.search(r"m\.measured_at\s*<=\s*p_to", sql)


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_bucket_count_is_clamped(path):
    """p_buckets dışarıdan geliyor; sınırsız bırakılırsa tek istek veritabanını meşgul eder."""
    sql = body(read(path))
    assert re.search(r"least\s*\(", sql)
    assert re.search(r"greatest\s*\(\s*coalesce\s*\(\s*p_buckets", sql)


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_the_span_cannot_be_zero(path):
    """p_from = p_to gelirse kova genişliği 0 olur ve sorgu sıfıra bölmeden düşer."""
    assert re.search(
        r"greatest\s*\(\s*extract\s*\(\s*epoch\s+from\s*\(\s*p_to\s*-\s*p_from\s*\)\s*\)\s*,\s*1\s*\)",
        body(read(path)),
    )


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_buckets_are_grouped_and_ordered(path):
    """Kovalar gruplanmazsa satır sayısı seyrelmez; sıralanmazsa grafik ileri geri zıplar."""
    sql = body(read(path))
    assert re.search(r"group\s+by", sql)
    assert re.search(r"order\s+by", sql)


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_function_is_declared_stable(path):
    """STABLE: aynı sorgu içinde aynı girdi aynı sonucu verir -> planlayıcı optimize edebilir.

    VOLATILE (varsayılan) kalsaydı Postgres her çağrıyı yeniden hesaplamak
    zorunda kalır, hiçbir hata çıkmadan yavaşlardı.
    """
    assert re.search(r"\bstable\b", header(read(path)))


# --- Doğrulama sorgusu ----------------------------------------------------


def test_verification_query_reads_the_security_setting(rls):
    """rls.sql'deki doğrulama sorgusu prosecdef'e bakmalı — false beklenir."""
    assert "prosecdef" in rls


def test_verification_query_checks_that_anon_cannot_execute(rls):
    """Yetkinin gerçekten daraldığı canlıda görülmeli, varsayılmamalı."""
    assert re.search(r"has_function_privilege\s*\(\s*'anon'", rls.replace("\n", " "))


def test_verification_query_shows_who_actually_holds_execute(rls):
    """proacl ham yetki listesini gösterir — yetkinin NEREDEN geldiğini söyleyen tek şey.

    has_function_privilege yalnızca true/false der. 2026-08-30'da anon_execute
    true döndüğünde, sebebin PUBLIC devri mi yoksa doğrudan bir grant mı olduğunu
    ayırt edecek bilgi ekranda yoktu; proacl o boşluğu kapatıyor.
    """
    assert "proacl" in rls
