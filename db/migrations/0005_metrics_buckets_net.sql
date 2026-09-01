-- =============================================================================
-- TraceBox — db/migrations/0005_metrics_buckets_net.sql
--
-- NE: `public.metrics_buckets(...)` fonksiyonuna AĞ sütunları eklenir
--     (net_sent_min/max/avg, net_recv_min/max/avg). Tablo, sütun veya satır
--     değişmez; yalnızca okuma fonksiyonunun döndürdüğü sütun kümesi genişler.
--
-- NEDEN: Overview ekranındaki dördüncü KPI kartı "Network (In / Out)" ve
--     referans görselde (dashboard/example/2) her KPI kartının sağında bir
--     mini grafik var. CPU, bellek ve disk için o grafiğin verisi zaten 0004'ten
--     geliyordu; ağ için gelmiyordu.
--
--     Alternatif, ham `metrics` satırlarını çekip tarayıcıda seyreltmekti. 1
--     saatlik pencerede cihaz başına 720 satır demek — bugün taşınır, "son 10
--     gün" seçildiğinde 173.000 satır olur. Seyreltmenin veritabanında yapılması
--     kararı (§9.7) tam olarak bunun için alınmıştı; ağ için istisna açmak, aynı
--     ekranda iki farklı veri yolu bırakmak olurdu.
--
-- NEDEN DROP + CREATE: `create or replace function` bir fonksiyonun DÖNÜŞ
--     TİPİNİ değiştiremez ("cannot change return type of existing function").
--     Sütun eklemek dönüş tipini değiştirmektir, dolayısıyla önce düşürülür.
--     İmza (uuid, timestamptz, timestamptz, int) aynı kaldığı için çağıran
--     taraf değişmiyor — dashboard eski koduyla da çalışır, yalnızca yeni
--     sütunları görmez.
--
--     Düşürme ile yeniden yaratma arasında kalan kısa aralıkta fonksiyon yoktur
--     ve o an gelen bir grafik isteği hata alır. Tek işlemde (BEGIN/COMMIT)
--     çalıştırıldığı için bu aralık dışarıdan hiç görünmez.
--
-- BİRİM NOTU: net_sent_mb / net_recv_mb agent tarafında ORAN olarak hesaplanır
--     (§4.2) — saniyedeki MB, kümülatif toplam değil. Bu yüzden ortalamaları
--     almak anlamlıdır; kümülatif sayaç olsalardı ortalama hiçbir şey ifade
--     etmezdi. Mbit'e çevirme arayüzde yapılır (×8), burada değil: veritabanı
--     kolonun kendi birimini korur.
--
-- GÜVENLİK: 0004'teki iki karar aynen korunur — SECURITY INVOKER (RLS çağıranın
--     kimliğiyle uygulanmaya devam eder) ve `set search_path = ''` (fonksiyon
--     içindeki her ad tam nitelikli). Gerekçeleri 0004'te uzun uzun yazılı.
--
--     Yetki iki ayrı yerden geliyor ve ikisi birden kapatılmalı: Postgres yeni
--     fonksiyona EXECUTE'u PUBLIC'e verir, Supabase ise public şemadaki yeni
--     fonksiyonlar için anon'a AYRICA doğrudan bir grant düşürür. Yalnızca
--     PUBLIC'ten almak yetmez — 2026-08-30'da tam olarak bu yaşandı, `from
--     public` sonrası anon_execute hâlâ true döndü. Fonksiyon YENİDEN
--     yaratıldığı için bu grant'lar da yeniden düşer; revoke tekrarlanmak
--     ZORUNDA.
--
-- TARİH: 2026-08-30 — M9 (Dashboard), Overview ekranı.
-- =============================================================================

begin;

drop function if exists
  public.metrics_buckets(uuid, timestamptz, timestamptz, int);

create function public.metrics_buckets(
  p_device_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_buckets   int default 1000
)
returns table (
  bucket_start  timestamptz,
  samples       int,
  cpu_min       real,
  cpu_max       real,
  cpu_avg       real,
  ram_min       int,
  ram_max       int,
  ram_avg       real,
  disk_min      real,
  disk_max      real,
  disk_avg      real,
  net_sent_min  real,
  net_sent_max  real,
  net_sent_avg  real,
  net_recv_min  real,
  net_recv_max  real,
  net_recv_avg  real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cfg as (
    select
      p_from as t0,
      -- Kova sayısı sınırlanır. 1000 ekranın çözünürlüğüne oranlı sayıdır ama
      -- parametre dışarıdan geliyor; sınırsız bırakılsaydı tek bir istek
      -- milyonlarca kova üretip veritabanını meşgul edebilirdi.
      least(greatest(coalesce(p_buckets, 1000), 1), 5000)::int as n,
      -- Aralık en az 1 saniye sayılır: p_from = p_to gelirse kova genişliği
      -- sıfır olur ve sorgu sıfıra bölme hatasıyla düşerdi.
      greatest(extract(epoch from (p_to - p_from)), 1) as span_s
  ),
  w as (
    select t0, n, span_s, span_s / n as width_s from cfg
  )
  select
    -- Satırın kovası: aralığın başından bu yana geçen saniye kova genişliğine
    -- bölünür, aşağı yuvarlanır, tekrar saniyeye çevrilip başlangıca eklenir.
    -- Dönen değer kovanın BAŞLANGIÇ anıdır.
    w.t0 + make_interval(
      secs => (floor(extract(epoch from (m.measured_at - w.t0)) / w.width_s) * w.width_s)::double precision
    )                             as bucket_start,
    count(*)::int                 as samples,
    min(m.cpu_percent)            as cpu_min,
    max(m.cpu_percent)            as cpu_max,
    avg(m.cpu_percent)::real      as cpu_avg,
    min(m.ram_used_mb)            as ram_min,
    max(m.ram_used_mb)            as ram_max,
    avg(m.ram_used_mb)::real      as ram_avg,
    min(m.disk_percent)           as disk_min,
    max(m.disk_percent)           as disk_max,
    avg(m.disk_percent)::real     as disk_avg,
    min(m.net_sent_mb)            as net_sent_min,
    max(m.net_sent_mb)            as net_sent_max,
    avg(m.net_sent_mb)::real      as net_sent_avg,
    min(m.net_recv_mb)            as net_recv_min,
    max(m.net_recv_mb)            as net_recv_max,
    avg(m.net_recv_mb)::real      as net_recv_avg
  from public.metrics m
  cross join w
  where m.device_id   = p_device_id
    and m.measured_at >= p_from
    and m.measured_at <  p_to
  group by 1
  order by 1;
$$;

revoke all    on function public.metrics_buckets(uuid, timestamptz, timestamptz, int) from public, anon;
grant  execute on function public.metrics_buckets(uuid, timestamptz, timestamptz, int) to authenticated;

commit;

-- =============================================================================
-- DOĞRULAMA — TEK satır dönmeli ve sütunlar şu değerleri taşımalı:
--   security_definer       = false                (true ise RLS atlanıyor — KRİTİK)
--   settings               = ["search_path=\"\""]  (boş search_path'in yazılışı)
--   authenticated_execute  = true
--   anon_execute           = false
--   grants                 = içinde anon=X/... SATIRI OLMAMALI
--   out_columns            = 17   (0004'ten gelen 11 + 6 ağ sütunu)
-- =============================================================================
select p.proname,
       p.prosecdef                                               as security_definer,
       p.proconfig                                               as settings,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
       has_function_privilege('anon',          p.oid, 'execute') as anon_execute,
       array_length(p.proallargtypes, 1) - 4                     as out_columns,
       p.proacl                                                  as grants
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'metrics_buckets';

-- -----------------------------------------------------------------------------
-- GERİ ALMA (çalıştırılmaz — sadece kayıt): 0004'ü baştan sona yeniden
-- çalıştırmak yeterli. O dosya `create or replace` kullanıyor ama dönüş tipi
-- geri daraldığı için önce düşürmek gerekir:
--   drop function if exists
--     public.metrics_buckets(uuid, timestamptz, timestamptz, int);
--   -- ardından 0004_metrics_buckets.sql
-- -----------------------------------------------------------------------------
