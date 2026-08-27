-- =============================================================================
-- TraceBox — db/retention.sql
--
-- Her gece çalışan otomatik silme işi (retention). Hesabın `retention_days`
-- politikasından daha eski satırları dört veri tablosundan siler:
-- metrics, logs, crash_snapshots ve commands.
--
-- Süre hesabı satır başına değil HESAP başına yapılır: her satır kendi
-- sahibinin accounts.retention_days değerine göre ölçülür (varsayılan 10 gün).
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
  -- `using accounts` join'i, satırın sahibinin retention_days değerine ulaşmak
  -- için. Ölçüt received_at: satırın SUNUCUYA vardığı an. (measured_at'i agent
  -- yazar; o sütun zaman çizelgesi içindir ve silmeye ölçüt olamaz.)
  -- (a.retention_days || ' days')::interval → örn. 10 → '10 days' → interval.
  delete from public.metrics m
    using public.accounts a
   where m.account_id = a.id
     and m.received_at < now() - (a.retention_days || ' days')::interval;

  -- --- logs ----------------------------------------------------------------
  delete from public.logs l
    using public.accounts a
   where l.account_id = a.id
     and l.received_at < now() - (a.retention_days || ' days')::interval;

  -- --- crash_snapshots -----------------------------------------------------
  delete from public.crash_snapshots c
    using public.accounts a
   where c.account_id = a.id
     and c.received_at < now() - (a.retention_days || ' days')::interval;

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
  delete from public.commands c
    using public.accounts a
   where c.account_id = a.id
     and c.status = 'applied'
     and c.created_at < now() - (a.retention_days || ' days')::interval;

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
