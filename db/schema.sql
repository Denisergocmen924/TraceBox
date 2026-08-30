-- =============================================================================
-- TraceBox — db/schema.sql
-- 6 tablo, indeksler, foreign key'ler ve grafik seyreltme fonksiyonu.
--
-- Bu dosya SIFIRDAN kurulum içindir: tabloların ŞU ANKİ halini anlatır ve boş bir
-- veritabanına çalıştırılır. Zaten kurulmuş bir veritabanını güncellemek için
-- db/migrations/ kullanılır. Şema değişince İKİSİ BİRDEN güncellenir —
-- kural: db/migrations/README.md.
--
-- accounts.id ile auth.users.id aynı UUID'dir; RLS politikaları bu sayede
-- doğrudan "account_id = auth.uid()" karşılaştırmasına iner.
--
-- metrics / logs / crash_snapshots tablolarında account_id, device_id'nin
-- yanında denormalize tutulur: satırın sahibi devices tablosuna join atılmadan
-- bilinir.
--
-- İKİ ZAMAN DAMGASI — ikisi ayrı sorulara cevap verir:
--   measured_at  AGENT yazar. Ölçümün makinede alındığı an. Zaman çizelgesi ve
--                grafikler buna bakar. Cihaz çöküşten sonra veriyi saatler
--                sonra gönderse bile gerçek an korunur.
--   received_at  SUNUCU yazar (collector). Satırın collector'a ulaştığı an.
--                RETENTION (silme işi) buna bakar.
--
-- Silme neden measured_at'e bakamaz: o alanı cihaz doldurur. Damgayı geleceğe
-- atan (ya da yalnızca saati bozuk olan) bir cihazın verisi asla "eski" olmaz
-- ve sonsuza kadar birikirdi — yani satırın silinip silinmeyeceğine verinin
-- sahibi karar verirdi. received_at'e cihaz dokunamaz.
--
-- Tüm foreign key'ler ON DELETE CASCADE: cihaz silinince ölçümleri, hesap
-- silinince tüm cihazları ve verileri birlikte silinir.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Aşağıdaki bloğun yorumu kaldırılırsa altı tablo da verileriyle birlikte
-- silinir ve şema sıfırdan kurulabilir hale gelir.
-- DİKKAT: tüm veriyi siler.
-- -----------------------------------------------------------------------------
-- drop table if exists commands        cascade;
-- drop table if exists crash_snapshots cascade;
-- drop table if exists logs            cascade;
-- drop table if exists metrics         cascade;
-- drop table if exists devices         cascade;
-- drop table if exists accounts        cascade;


-- =============================================================================
-- 1) accounts — Supabase Auth kullanıcısının uygulamaya özel uzantısı
-- =============================================================================
-- Satırı triggers.sql içindeki on_auth_user_created trigger'ı ekler: auth.users
-- tablosuna her yeni kayıt düştüğünde aynı id ile burada bir satır açılır.
create table accounts (
  id             uuid primary key references auth.users(id) on delete cascade,

  -- Retention job'ının (retention.sql) okuduğu değer: bu hesabın satırları kaç
  -- gün sonra silinecek. rls.sql'de accounts için UPDATE politikası tanımlı
  -- olmadığından dashboard üzerinden değiştirilemez — policy, config değil.
  retention_days integer     not null default 10,

  -- TraceBox'ın kendi ürün planı; Supabase'in faturalandırma planından bağımsız.
  plan           text        not null default 'free',

  created_at     timestamptz not null default now()
);


-- =============================================================================
-- 2) devices — izlenen makine: kimlik + envanter + durum
-- =============================================================================
-- Bir satır = kurulu bir agent. Agent kendi device_id'sini bilmez; yalnızca
-- anahtarını sunar, sunucu satırı anahtardan bulur.
create table devices (
  -- Değeri sunucu üretir; agent'ın gönderdiği hiçbir alan bu id'yi belirlemez.
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id) on delete cascade,
  device_name         text not null,

  -- Cihaz anahtarının SHA-256 özeti; anahtarın düz hali saklanmaz. Doğrulama
  -- sırasında collector gelen anahtarın özetini hesaplar ve bu sütunla
  -- constant-time karşılaştırır.
  key_hash            text not null,

  -- --- envanter çekirdeği (POST /inventory ile yazılır, üzerine yazma) ---------
  -- Hepsi nullable: agent bir alanı okuyamazsa o alan null kalır, envanterin
  -- geri kalanı yine de yazılır.
  cpu_model           text,
  cpu_cores_physical  integer,
  cpu_cores_logical   integer,
  arch                text,
  ram_total_mb        integer,
  disk_total_mb       integer,
  os_name             text,
  os_version          text,
  kernel_version      text,

  -- --- statik eklentiler (config'de enabled_addons içindeyse dolu) -------------
  gpu_model           text,
  external_ip         text,

  -- --- durum -----------------------------------------------------------------
  last_boot           timestamptz,
  agent_version       text,

  -- Cihazda açık olan eklentiler, jsonb dizi olarak: ["swap","load_avg"].
  enabled_addons      jsonb   not null default '[]',

  -- Pause durumunun sunucu kopyası; dashboard rozeti bu sütunu okur. Tek
  -- doğruluk kaynağı agent'ın state.json dosyasıdır (single writer).
  logging_enabled     boolean not null default true,

  -- Cihazdan en son ne zaman istek geldiği. Offline tespiti bu değere bakar
  -- (ör. now() - last_seen > 2 dk ise offline sayılır).
  last_seen           timestamptz,

  -- Silme akışının ara durumu ("emir verildi, cihaz henüz duymadı") burada
  -- bir bayrakla tutulmuyor: bilgi `commands` tablosunda zaten var —
  -- type='delete' ve status='pending' olan satır. Satırı, agent komutu
  -- uygulayıp ack'ledikten sonra collector siler (migration 0003).

  created_at          timestamptz not null default now()
);

-- Dashboard'ın "bu hesabın cihazları" sorgusunu karşılar.
create index devices_account_id_idx on devices (account_id);

-- Her istekte sha256(anahtar) ile arama yapılır. Unique olması aynı anahtarın
-- iki cihaza yazılmasını da engeller.
create unique index devices_key_hash_key on devices (key_hash);

-- Aynı hesap içinde iki cihaz aynı adı taşıyamaz; ihlalde POST /devices 409
-- döner (M5). Kapsam account_id ile sınırlı — farklı hesaplar aynı adı
-- kullanabilir.
create unique index devices_account_name_key on devices (account_id, device_name);


-- =============================================================================
-- 3) metrics — zaman serisi ölçümler
-- =============================================================================
-- Bir satır = bir ölçüm anı. Metrikler düz sütunlarda tutulur (key/value satırı
-- değil), böylece avg/max ve zaman aralığı sorguları doğrudan çalışır.
create table metrics (
  -- UUID'yi agent üretir; sütunun default'u yoktur, id'siz satır yazılamaz.
  -- Shipper at-least-once çalıştığından aynı batch tekrar gönderilebilir;
  -- collector INSERT ... ON CONFLICT (id) DO NOTHING ile tekrarı eler.
  id                uuid primary key,
  device_id         uuid not null references devices(id)  on delete cascade,
  account_id        uuid not null references accounts(id) on delete cascade,
  measured_at       timestamptz not null,
  received_at       timestamptz not null default now(),

  -- --- çekirdek (her zaman toplanır) -----------------------------------------
  cpu_percent       real,
  ram_used_mb       integer,
  disk_percent      real,

  -- Ağ değerleri kümülatif sayaç değil rate'tir: agent iki ölçüm arasındaki
  -- farkı geçen süreye böler ve sonucu buraya yazar.
  net_sent_mb       real,
  net_recv_mb       real,

  -- --- eklentiler (config'de kapalıysa null kalır) ----------------------------
  temperature_c     real,
  swap_used_mb      integer,

  -- load average yalnızca Linux'ta okunur; diğer platformlarda null kalır.
  load_avg_1        real,
  load_avg_5        real,
  load_avg_15       real,

  gpu_usage_percent real,
  gpu_vram_used_mb  integer
);

-- Dashboard'ın sorgu şekli: "şu cihazın şu zaman aralığındaki metrikleri".
-- Sütun sırası bu şekle uyar: önce eşitlik (device_id), sonra aralık.
create index metrics_device_measured_idx on metrics (device_id, measured_at);

-- Retention her gece 'received_at eskiyse sil' taraması yapar; account_id ile
-- birleşik indeks bu taramayı hesap bazında hedefler (db/retention.sql, M8).
create index metrics_account_received_idx on metrics (account_id, received_at);


-- =============================================================================
-- 4) logs — normalize edilmiş sistem logları
-- =============================================================================
-- Agent'ın LogSource arayüzü (agent/logsources/base.py) journald gibi OS'a özgü
-- çıktıları buradaki dört alana çevirir; tablo hiçbir OS detayı tutmaz.
create table logs (
  id           uuid primary key,                        -- agent üretir (bkz. metrics.id)
  device_id    uuid not null references devices(id)  on delete cascade,
  account_id   uuid not null references accounts(id) on delete cascade,
  measured_at  timestamptz not null,
  received_at  timestamptz not null default now(),

  -- Dört seviye kabul edilir; journald'ın 8 PRIORITY değeri agent tarafında
  -- bunlara indirgenir. CHECK, listede olmayan bir seviyenin yazılmasını
  -- veritabanı düzeyinde engeller.
  level        text not null check (level in ('info','warning','error','critical')),

  -- Mesaj kırpılmadan saklanır. Postgres büyük değerleri TOAST ile sıkıştırıp
  -- satır dışına taşır.
  message      text not null,

  -- Logu üreten servis/birim (journald'da _SYSTEMD_UNIT). Her kaynakta
  -- bulunmadığı için nullable.
  source       text
);

create index logs_device_measured_idx on logs (device_id, measured_at);

-- Retention her gece 'received_at eskiyse sil' taraması yapar; account_id ile
-- birleşik indeks bu taramayı hesap bazında hedefler (db/retention.sql, M8).
create index logs_account_received_idx on logs (account_id, received_at);


-- =============================================================================
-- 5) crash_snapshots — acil flush anının fotoğrafı
-- =============================================================================
-- Satır yalnızca bir eşik aşıldığında yazılır (cpu/ram/disk yüksek ya da
-- error/critical seviyeli log geldi) ve o anda kaynak tüketen süreçleri tutar.
create table crash_snapshots (
  id             uuid primary key,                      -- agent üretir
  device_id      uuid not null references devices(id)  on delete cascade,
  account_id     uuid not null references accounts(id) on delete cascade,
  measured_at    timestamptz not null,
  received_at    timestamptz not null default now(),

  -- Flush'ı tetikleyen eşik: 'cpu' | 'ram' | 'disk' | 'log'. TRIGGER SQL'de
  -- reserved word olduğu için sütun ve wire payload alanı trigger_reason adını
  -- taşır.
  -- CHECK tanımlı değil: yeni bir tetikleyici türü eklendiğinde satır reddedilmez.
  trigger_reason text,

  -- [{"name":"chrome","cpu":42.1,"ram_mb":2100}, ...] biçiminde, değişken
  -- uzunlukta süreç listesi; yalnızca bütün olarak okunur.
  processes      jsonb not null
);

create index crash_snapshots_device_measured_idx on crash_snapshots (device_id, measured_at);

-- Retention her gece 'received_at eskiyse sil' taraması yapar; account_id ile
-- birleşik indeks bu taramayı hesap bazında hedefler (db/retention.sql, M8).
create index crash_snapshots_account_received_idx on crash_snapshots (account_id, received_at);


-- =============================================================================
-- 6) commands — dashboard'dan agent'a kontrol kuyruğu
-- =============================================================================
-- Akış: dashboard satırı 'pending' olarak INSERT eder -> agent GET /commands ile
-- çeker -> uygular -> bir sonraki /ingest gövdesinde id'yi ack'ler -> collector
-- satırı 'applied' yapar. Agent dinleyen port açmaz; komutlar yalnızca bu
-- kuyruğun yoklanmasıyla ulaşır.
create table commands (
  -- Bu id'yi sunucu üretir (metrics/logs'un tersine default vardır). Agent aynı
  -- id'yi ikinci kez gördüğünde komutu tekrar uygulamaz.
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references devices(id)  on delete cascade,
  account_id   uuid not null references accounts(id) on delete cascade,

  -- pause  : buluta gönderimi durdurur, yerel toplama sürer
  -- resume : gönderime devam eder, spool'da birikeni eskiden yeniye boşaltır
  -- delete : agent'ın tam temizliği / self-uninstall
  type         text not null check (type in ('pause','resume','delete')),

  -- pending -> applied yönünde tek yönlü ilerler; geri dönüşü yoktur. Komutu
  -- yeniden denemek için dashboard yeni bir satır ekler.
  status       text not null default 'pending' check (status in ('pending','applied')),

  created_at   timestamptz not null default now(),
  applied_at   timestamptz
);

-- Agent'ın komut poll'unda attığı sorgunun şekli: bu cihazın bekleyen komutları.
create index commands_device_status_idx on commands (device_id, status);


-- =============================================================================
-- 7) metrics_buckets — grafik için seyreltme (downsampling) fonksiyonu
-- =============================================================================
-- Tablo değil, OKUMA fonksiyonu. Verilen cihazın verilen zaman aralığını eşit
-- genişlikte kovalara böler ve her kovadan min / max / ortalama döndürür.
--
-- Neden gerekli: agent 5 saniyede bir ölçüyor — günde 17.280, 10 günde ~173.000
-- satır (tek cihaz). Grafik ~1200 piksel geniş; noktaların %99'u zaten
-- çizilemez. Ham satırları tarayıcıya indirmek, çizilmeyecek veriyi ağdan
-- geçirmek olurdu. Seyreltme burada, veritabanında yapılır: hangi aralığa
-- bakılırsa bakılsın ekrana ~1000 nokta iner (CLAUDE.md §9.7).
--
-- Neden min/max da dönüyor: ortalama tek başına yalan söyler. 5 saniyelik bir
-- CPU patlaması 15 dakikalık bir kovanın ortalamasında kaybolur — oysa o patlama
-- ürünün varlık sebebi. Grafikte bant min-max, içinden geçen çizgi ortalamadır
-- (§9.6 madde 6). Yalnızca max da bir tür yalandır: makineyi olduğundan yoğun
-- gösterir.
--
-- SECURITY INVOKER (kritik): fonksiyon ÇAĞIRANIN yetkisiyle koşar, dolayısıyla
-- metrics üzerindeki RLS politikası uygulanmaya devam eder — başkasının
-- device_id değeri geçilirse sıfır satır döner. DEFINER olsaydı RLS atlanır ve
-- device_id kullanıcıdan geldiği için doğrudan bir okuma kapısı açılırdı.
-- (triggers.sql'deki handle_new_user bilerek DEFINER'dır; gerekçesi orada.)
-- set search_path = '' aynı savunmanın ikinci katmanı: fonksiyon içindeki her ad
-- tam nitelikli yazılır, çağıranın search_path'i hangi tablonun okunduğunu
-- değiştiremez.
--
-- Boş kova dönmez: cihazın kapalı olduğu aralıkta o kovalar sonuç kümesinde hiç
-- görünmez. Arayüz iki komşu kovanın zaman farkına bakıp boşluğu kendi çizer.
--
-- Yeni indeks gerekmez: sorgu yukarıdaki (device_id, measured_at) indeksi
-- üzerinden yürür.
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
