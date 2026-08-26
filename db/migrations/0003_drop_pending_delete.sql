-- =============================================================================
-- TraceBox — db/migrations/0003_drop_pending_delete.sql
--
-- NE: `devices` tablosundan `pending_delete` sütunu kaldırılır.
--
-- NEDEN: Sütun, silme akışının ara durumunu ("emir verildi, cihaz henüz
--     duymadı") işaretlemek için tasarlanmıştı. Ama yazacak kimse yoktu:
--
--       * dashboard yazamaz — db/rls.sql `devices` üzerindeki UPDATE yetkisini
--         tek sütuna daraltıyor: grant update (device_name).
--       * collector yazmıyor — supabase_client.py'deki DEVICE_WRITABLE_COLUMNS
--         listesinin dışında; yanındaki not "kimin yazacağı M6'da karara
--         bağlanacak" diyordu.
--
--     Yazan olmayınca sütun her satırda `false` kaldı: kimsenin dolduramadığı
--     bir bayrak, hiçbir şey işaretlemiyor. Bilgi zaten `commands` tablosunda
--     duruyor — bekleyen silme = (type='delete' and status='pending').
--     Kopyayı yaşatmak için ya kilit gevşetilecekti ya yeni bir mekanizma
--     (trigger / ayrı endpoint) eklenecekti; kaldırmak üçünün de bedelini
--     sıfırlıyor.
--
-- VERİ KAYBI: yok. Sütun hiç yazılmadı, tüm satırlarda varsayılan `false`.
--
-- SIRA (ÖNEMLİ): bu migration, `pending_delete`'i artık SELECT etmeyen
--     collector sürümü Fly'a deploy EDİLDİKTEN SONRA çalıştırılır. Ters sırada
--     çalıştırılırsa canlı collector olmayan bir sütunu istemeye devam eder ve
--     cihaz kimliği doğrulanamaz (device key ile gelen her istek hata alır).
--
-- TARİH: 2026-08-26 — M6 (Komutlar). Karar: md/memory/decisions.md.
-- =============================================================================

alter table public.devices drop column if exists pending_delete;

-- =============================================================================
-- DOĞRULAMA — SIFIR satır dönmeli. Bir satır dönerse sütun hâlâ duruyordur.
-- =============================================================================
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'devices'
   and column_name  = 'pending_delete';

-- -----------------------------------------------------------------------------
-- GERİ ALMA (çalıştırılmaz — sadece kayıt):
--   alter table public.devices
--     add column pending_delete boolean not null default false;
-- -----------------------------------------------------------------------------
