-- =============================================================================
-- TraceBox — db/migrations/0004_metrics_buckets.sql
--
-- NE: `public.metrics_buckets(...)` okuma fonksiyonu eklenir. Verilen cihazın
--     verilen zaman aralığını eşit genişlikte kovalara böler ve her kovadan
--     min / max / ortalama döndürür. Hiçbir tablo, sütun veya satır değişmez.
--
-- NEDEN: Agent 5 saniyede bir ölçüyor — günde 17.280, 10 günde ~173.000 satır
--     (tek cihaz). Grafik ise ~1200 piksel geniş; noktaların %99'u zaten
--     çizilemez. Ham satırları tarayıcıya indirmek, çizilmeyecek veriyi ağdan
--     geçirmek olurdu. Seyreltme veritabanında yapılır: hangi aralığa bakılırsa
--     bakılsın ekrana ~1000 nokta iner, 1 saatlik görünüm de 10 günlük görünüm
--     de aynı hızda açılır (CLAUDE.md §9.7).
--
--     min ve max, ortalamayla BİRLİKTE döner. Ortalama tek başına yalan söyler:
--     5 saniyelik bir CPU patlaması 15 dakikalık bir kovanın ortalamasında
--     kaybolur, oysa o patlama ürünün varlık sebebi. Grafikte bant min-max,
--     içinden geçen çizgi ortalamadır (§9.6 madde 6). Yalnızca max da bir tür
--     yalandır — makineyi olduğundan yoğun gösterir.
--
-- GÜVENLİK — SECURITY INVOKER, bu dosyanın en kritik satırı:
--     Fonksiyon ÇAĞIRANIN yetkisiyle koşar, dolayısıyla `metrics` üzerindeki
--     RLS politikası (account_id = auth.uid()) uygulanmaya devam eder.
--     Başkasının device_id değeri parametre olarak geçilirse SIFIR satır döner.
--
--     SECURITY DEFINER olsaydı fonksiyon SAHİBİNİN yetkisiyle koşar ve RLS
--     atlanırdı: giriş yapmış herhangi bir kullanıcı, rastgele bir device_id
--     yazarak başkasının metriklerini okuyabilirdi. Parametreyi kullanıcı
--     verdiği için bu teorik bir risk değil, doğrudan bir okuma kapısı olurdu.
--
--     Projede bilerek DEFINER olan bir fonksiyon var: triggers.sql içindeki
--     handle_new_user. Onun accounts tablosuna yazabilmesinin başka yolu yok —
--     tetiklendiği anda ortada henüz bir oturum yok. İki fonksiyon, iki zıt
--     karar; ikisinin de gerekçesi dosyasında yazılı.
--
--     `set search_path = ''` aynı savunmanın ikinci katmanı: fonksiyon
--     içindeki her ad tam nitelikli (public.metrics) yazılır, böylece çağıranın
--     search_path ayarı fonksiyonun hangi tabloyu okuduğunu değiştiremez.
--
-- BOŞ KOVA DÖNMEZ: cihazın kapalı olduğu bir aralıkta o kovalar sonuç kümesinde
--     hiç görünmez. Bilgi kaybı değil — arayüz iki komşu kovanın zaman farkına
--     bakıp boşluğu kendisi çizer. Boş kovaları da döndürmek, üç saatlik verisi
--     olan bir cihaz için 1000 satırın 900'ünü boşuna taşımak olurdu.
--
-- İNDEKS: yeni indeks GEREKMEZ. Sorgu (device_id, measured_at) üzerinden yürür;
--     o indeks schema.sql'de metrics tablosuyla birlikte zaten oluşturuluyor.
--
-- TARİH: 2026-08-29 — M9 (Dashboard), zaman çizelgesi dilimi.
--        2026-08-30 — düzeltme: revoke yalnızca PUBLIC'ten yapılıyordu,
--        anon'un Supabase default privileges üzerinden gelen DOĞRUDAN
--        grant'ı yerinde kalmıştı (canlı doğrulama anon_execute = true
--        döndü). Dosya baştan sona yeniden çalıştırılabilir.
-- =============================================================================

create or replace function public.metrics_buckets(
  p_device_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_buckets   int default 1000
)
returns table (
  bucket_start timestamptz,
  samples      int,
  cpu_min      real,
  cpu_max      real,
  cpu_avg      real,
  ram_min      int,
  ram_max      int,
  ram_avg      real,
  disk_min     real,
  disk_max     real,
  disk_avg     real
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
    avg(m.disk_percent)::real     as disk_avg
  from public.metrics m
  cross join w
  where m.device_id   = p_device_id
    and m.measured_at >= p_from
    and m.measured_at <  p_to
  group by 1
  order by 1;
$$;

-- Yetki İKİ ayrı yerden geliyor; ikisini birden kapatmak gerekiyor:
--
--   1. Postgres yeni bir fonksiyona EXECUTE'u varsayılan olarak PUBLIC'e verir.
--   2. Supabase, public şemasındaki yeni fonksiyonlar için `alter default
--      privileges ... grant all on functions to anon, authenticated,
--      service_role` tanımlıdır — yani anon'a AYRICA, DOĞRUDAN bir grant düşer.
--
-- Yalnızca PUBLIC'ten almak yetmez: 2. maddedeki doğrudan grant yerinde kalır.
-- 2026-08-30 canlı doğrulamasında tam olarak bu oldu — `from public` sonrası
-- anon_execute hâlâ true döndü. Bu yüzden anon açıkça yazılır; dosyanın geri
-- kalanındaki iki revoke da (devices, commands) aynı sebeple rolleri sayar.
--
-- RLS zaten sıfır satır döndürürdü, ama kapatılabilecek bir kapıyı açık
-- bırakmanın karşılığı yok. service_role bilerek dokunulmadan bırakıldı:
-- collector zaten RLS'i bypass ediyor.
-- İki satır da tekrar çalıştırılabilir: aynı sonucu üretir, hata vermez.
revoke all    on function public.metrics_buckets(uuid, timestamptz, timestamptz, int) from public, anon;
grant  execute on function public.metrics_buckets(uuid, timestamptz, timestamptz, int) to authenticated;

-- =============================================================================
-- DOĞRULAMA — TEK satır dönmeli ve sütunlar şu değerleri taşımalı:
--   security_definer       = false                (true ise RLS atlanıyor — KRİTİK)
--   settings               = ["search_path=\"\""]  (boş search_path'in yazılışı)
--   authenticated_execute  = true
--   anon_execute           = false
--   grants                 = içinde anon=X/... SATIRI OLMAMALI
--
-- settings neden `search_path=""` görünüyor: Postgres GUC değerlerini proconfig
-- içinde tırnaklayarak saklar; boş dize `""` olarak yazılır. Beklenen budur.
--
-- grants sütunu proacl'ı ham haliyle gösterir. anon_execute tek başına true/false
-- der ama NEREDEN geldiğini söylemez; yetkinin doğrudan bir grant'tan mı yoksa
-- PUBLIC'ten mi devraldığını yalnızca bu liste gösterir. İlk çalıştırmada
-- anon_execute'un true dönmesinin sebebi buradan okunabilirdi.
-- =============================================================================
select p.proname,
       p.prosecdef                                        as security_definer,
       p.proconfig                                        as settings,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
       has_function_privilege('anon',          p.oid, 'execute') as anon_execute,
       p.proacl                                           as grants
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'metrics_buckets';

-- -----------------------------------------------------------------------------
-- GERİ ALMA (çalıştırılmaz — sadece kayıt):
--   drop function if exists
--     public.metrics_buckets(uuid, timestamptz, timestamptz, int);
-- -----------------------------------------------------------------------------
