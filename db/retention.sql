-- =============================================================================
-- TraceBox — db/retention.sql
--
-- Her gece çalışan otomatik silme işi (retention). 10 günden eski satırları
-- dört veri tablosundan siler: metrics, logs, crash_snapshots ve commands.
--
-- Süre bütün hesaplar için aynı ve sabittir (10 gün); `interval '10 days'`
-- her DELETE içinde ayrı ayrı yazılıdır.
--
-- CLAUDE.md §5 — silme ölçütü sunucunun yazdığı zaman damgasıdır.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) pg_cron
--
-- Zamanlanmış işleri veritabanının içinde çalıştıran uzantı. `if not exists`
-- sayesinde uzantı zaten kuruluysa bu satır sessizce geçer, hata vermez.
-- Kurulumla birlikte `cron` şeması gelir; işler `cron.job` tablosunda durur.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;


-- -----------------------------------------------------------------------------
-- 2) Zamanlanmış iş
--
-- cron.schedule(jobname, schedule, command) üç parça alır:
--
--   jobname  'tracebox_retention' — işin adı. AYNI adla ikinci kez çalıştırılırsa
--            pg_cron yeni bir iş EKLEMEZ, mevcut işin üzerine yazar (upsert).
--            Dosyanın tekrar tekrar çalıştırılması kopya iş üretmez.
--   schedule '0 0 * * *' — beş alanlı cron ifadesi: dakika 0, saat 0, her gün,
--            her ay, haftanın her günü. Yani her gece 00:00. Saat dilimi
--            veritabanının saatidir (Supabase'de UTC).
--   command  $$ ... $$ arasındaki SQL. İş her tetiklendiğinde bu blok çalışır.
--            Dolar işaretli sınırlayıcı ($$) kullanılır; blok içindeki tek
--            tırnakların kaçırılması (escape) gerekmesin diye.
--
-- Blok içindeki dört DELETE tek bir transaction'da çalışır: dördü birden
-- başarılı olur ya da hiçbiri uygulanmaz.
--
-- İş, onu zamanlayan rolün yetkileriyle koşar; RLS politikaları bu role
-- uygulanmaz, dolayısıyla silme tüm hesapların satırlarını görebilir.
-- -----------------------------------------------------------------------------
select cron.schedule('tracebox_retention', '0 0 * * *', $$

  -- --- metrics -------------------------------------------------------------
  -- Ölçüt received_at: satırın SUNUCUYA vardığı an. (measured_at'i agent
  -- yazar; o sütun zaman çizelgesi içindir ve silmeye ölçüt olamaz.)
  delete from public.metrics
   where received_at < now() - interval '10 days';

  -- --- logs ----------------------------------------------------------------
  delete from public.logs
   where received_at < now() - interval '10 days';

  -- --- crash_snapshots -----------------------------------------------------
  delete from public.crash_snapshots
   where received_at < now() - interval '10 days';

  -- --- commands ------------------------------------------------------------
  -- İki farkla:
  --
  --   1) Ölçüt created_at. Bu tabloda received_at sütunu yok; satırı agent
  --      değil dashboard yazar ve created_at zaten `default now()` ile
  --      veritabanı saatinden dolar. db/rls.sql, INSERT yetkisini kolon
  --      düzeyinde (device_id, account_id, type) daraltır — created_at o
  --      listede olmadığı için istemci bu sütuna değer veremez.
  --
  --   2) status = 'applied' süzgeci. Yalnızca UYGULANMIŞ komutlar silinir.
  --      'pending' satır henüz teslim edilmemiş bir emirdir; yaşı ne olursa
  --      olsun burada silinmez. (Çevrimdışı bir cihaz için bekleyen komut
  --      cihaz geri dönene kadar durur; cihaz hiç dönmezse satır, devices
  --      kaydının silinmesiyle CASCADE üzerinden gider.)
  delete from public.commands
   where status = 'applied'
     and created_at < now() - interval '10 days';

$$);


-- =============================================================================
-- DOĞRULAMA — TEK satır dönmeli.
--
-- active = true  → iş zamanlanmış ve çalışmaya hazır.
-- schedule       → '0 0 * * *' olmalı.
-- Sıfır satır dönerse cron.schedule çağrısı işi kaydetmemiştir.
-- =============================================================================
select jobid, jobname, schedule, active
  from cron.job
 where jobname = 'tracebox_retention';
