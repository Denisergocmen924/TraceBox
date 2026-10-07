-- =============================================================================
-- TraceBox — db/migrations/0006_metrics_buckets_addons.sql
--
-- NE: `public.metrics_buckets(...)` fonksiyonuna EKLENTİ sütunları eklenir:
--     temperature_c, swap_used_mb, load_avg_1/5/15, gpu_usage_percent,
--     gpu_vram_used_mb — her biri için min / max / avg (21 yeni çıkış sütunu).
--     Tablo, sütun veya satır değişmez; yalnızca okuma fonksiyonunun
--     döndürdüğü sütun kümesi genişler.
--
-- NEDEN: Cihaz detayındaki zaman çizelgesi eklenti verisini türüne göre
--     çizecek (sıcaklık, swap, yük ortalaması, GPU). Ham `metrics` satırlarını
--     tarayıcıda seyreltmek §9.7'nin kararına (seyreltme veritabanında) aykırı
--     olurdu; ağ sütunlarında (0005) verilen gerekçe burada da geçerli.
--
--     `external_ip` ve `crash_processes` BİLEREK yok: ilki zaman serisi değil
--     (devices satırında tek değer), ikincisi `crash_snapshots` tablosunda.
--
-- NULL DAVRANIŞI: eklenti kapalıyken metrics sütunu null yazılır; min/max/avg
--     null'ları atladığı için kovanın üçlüsü de null döner — "ölçülmedi",
--     sıfır değil. Arayüz bu kovaları çizmez.
--
-- NEDEN DROP + CREATE: dönüş tipi değiştiği için `create or replace` olmaz
--     (0005'te aynı gerekçe). İmza aynı kaldığı için çağıran taraf değişmez;
--     eski dashboard kodu yeni sütunları yalnızca görmez. Tek işlemde
--     (BEGIN/COMMIT) çalıştığı için düşürme ile yaratma arası dışarıdan
--     görünmez.
--
-- GÜVENLİK: 0004'teki iki karar aynen korunur — SECURITY INVOKER ve
--     `set search_path = ''`. Fonksiyon yeniden yaratıldığı için Supabase'in
--     anon'a düşürdüğü doğrudan grant da yeniden düşer; revoke tekrarlanır
--     (gerekçe 0005'te).
--
-- TARİH: 2026-10-07 — eklenti grafikleri.
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
  net_recv_avg  real,
  temp_min            real,
  temp_max            real,
  temp_avg            real,
  swap_min            int,
  swap_max            int,
  swap_avg            real,
  load1_min           real,
  load1_max           real,
  load1_avg           real,
  load5_min           real,
  load5_max           real,
  load5_avg           real,
  load15_min          real,
  load15_max          real,
  load15_avg          real,
  gpu_usage_min       real,
  gpu_usage_max       real,
  gpu_usage_avg       real,
  gpu_vram_min        int,
  gpu_vram_max        int,
  gpu_vram_avg        real
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
    avg(m.net_recv_mb)::real      as net_recv_avg,
    min(m.temperature_c)            as temp_min,
    max(m.temperature_c)            as temp_max,
    avg(m.temperature_c)::real      as temp_avg,
    min(m.swap_used_mb)             as swap_min,
    max(m.swap_used_mb)             as swap_max,
    avg(m.swap_used_mb)::real       as swap_avg,
    min(m.load_avg_1)               as load1_min,
    max(m.load_avg_1)               as load1_max,
    avg(m.load_avg_1)::real         as load1_avg,
    min(m.load_avg_5)               as load5_min,
    max(m.load_avg_5)               as load5_max,
    avg(m.load_avg_5)::real         as load5_avg,
    min(m.load_avg_15)              as load15_min,
    max(m.load_avg_15)              as load15_max,
    avg(m.load_avg_15)::real        as load15_avg,
    min(m.gpu_usage_percent)        as gpu_usage_min,
    max(m.gpu_usage_percent)        as gpu_usage_max,
    avg(m.gpu_usage_percent)::real  as gpu_usage_avg,
    min(m.gpu_vram_used_mb)         as gpu_vram_min,
    max(m.gpu_vram_used_mb)         as gpu_vram_max,
    avg(m.gpu_vram_used_mb)::real   as gpu_vram_avg
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
--   out_columns            = 38   (0004'ten gelen 11 + 6 ağ + 21 eklenti sütunu)
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
-- GERİ ALMA (çalıştırılmaz — sadece kayıt): dönüş tipi geri daraldığı için
-- önce düşürmek, ardından 0005'i yeniden çalıştırmak gerekir:
--   drop function if exists
--     public.metrics_buckets(uuid, timestamptz, timestamptz, int);
--   -- ardından 0005_metrics_buckets_net.sql
-- -----------------------------------------------------------------------------
