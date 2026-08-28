# Dashboard — M9

Next.js 16 (App Router) + Tailwind v4 + TypeScript. Kullanıcının **okuma** penceresi.
Ayrıntılı spec: `CLAUDE.md` §9.

## Mimari — tek cümle

**Veriyi tarayıcı çeker.** Next.js SSR ile veri çekmez; sayfa yüklendikten sonra tarayıcı
doğrudan Supabase'e bağlanır. Fly'ın işi yalnızca JS/HTML sunmak (§9.1). Bunun üç sonucu var:

- Fly instance'ı küçük ve sabit yükte kalır — kullanıcı sayısı arttıkça büyümesi gerekmez.
- Realtime (§9.9) mümkün olur; sunucu çekseydi canlı akış zaten çalışmazdı.
- Derleme çıktısının tamamı statik (`npm run build` → tüm route'lar `○ Static`).

**Okuma:** Supabase client + user JWT; RLS (`account_id = auth.uid()`) satır bazında korur.
**Collector'a hiçbir okuma isteği gitmez.**

**Yazma:** yalnızca "Cihaz Ekle" collector'dan geçer (`POST /devices` — anahtar üretimi ve
hash'leme tarayıcıda yapılamaz). pause/resume/delete `commands` tablosuna doğrudan INSERT,
cihaz adı `devices` UPDATE, zorla kaldırma `devices` DELETE — hepsi RLS ve kolon grant'ları
altında.

## Bugünkü durum — iskelet

| Yol | Durum |
|---|---|
| `/login` | **Geçici**, süssüz giriş formu. Kayıt ekranı YOK (§9.2) |
| `/devices` | ✅ Cihaz kartları — künye, dört durum rozeti, üç ölçü çubuğu (§9.3) |
| `/devices/[id]` | Yer tutucu — detay ekranı sonraki dilimde (§9.4) |
| `/` | Ekran değil, yol ayrımı: oturum varsa `/devices`, yoksa `/login` |

`/login` bilerek süssüzdür. §9.12'deki kara kutu animasyonlu vitrin **en son** yapılır;
o zaman bu dosya baştan yazılır. Bugünkü işi, altındaki tesisatın (Supabase Auth → oturum →
RLS'li okuma) gerçekten çalıştığını kanıtlamak.

## Çalıştırma

```bash
cd dashboard
npm install
cp .env.example .env.local     # değerleri Supabase panelinden doldur
npm run dev                    # http://localhost:3000
```

`.env.local` git'e girmez (`.env.*` engelli). İki değişken de `NEXT_PUBLIC_` öneklidir,
yani derlemede JS'e gömülür ve herkes görür — **bu bir sır değildir**. anon key'in tek
yetkisi "RLS'e tabi bir istemciyim" demektir. Sır olan `SUPABASE_SERVICE_KEY`'dir ve
yalnızca collector'da durur.

**İlk hesap Supabase panelinden elle açılır** (Authentication → Users → Add user).
`accounts` satırı `db/triggers.sql`'deki `on_auth_user_created` trigger'ı ile otomatik oluşur.

## Klasör düzeni

```
dashboard/
├── app/
│   ├── layout.tsx          # kök gövde + metadata
│   ├── globals.css         # görsel dil tokenleri (§9.11) — renkler BURADA, bileşende değil
│   ├── page.tsx            # yol ayrımı
│   ├── login/page.tsx      # geçici giriş formu
│   └── devices/
│       ├── page.tsx        # ekran 2 — ızgara, 10 sn yenileme
│       ├── DeviceCard.tsx  # kart: künye + rozet + üç çubuk
│       └── [id]/page.tsx   # ekran 3 (yer tutucu)
├── lib/
│   ├── supabase.ts         # tek istemci, tembel kurulum
│   ├── useSession.ts       # loading / signedIn / signedOut — üçü AYRI hâl
│   ├── devices.ts          # sorgu + dört durumun türetilmesi
│   └── time.ts             # "12 saniye önce", MB→GB
├── next.config.ts          # output: standalone (Fly Docker imajı için)
└── postcss.config.mjs      # Tailwind v4 — tailwind.config.js YOK, tema CSS içinde
```

## Henüz yapılmayanlar

- **Cihaz detayı (§9.4)** — dört dilim: yerleşim + sağ panel, log listesi,
  zaman çizelgesi (migration ister), aksiyonlar + onay penceresi.
- **Deploy:** collector'dan **ayrı** bir Fly app olacak (§9.1). Dockerfile + fly.toml
  henüz yazılmadı.
- **CORS:** collector'da CORS middleware yok — "Cihaz Ekle" tarayıcıdan bugün bloklanır
  (§9.13). Dashboard'ın origin'i belli olunca eklenecek.
- **Grafik seyreltmesi:** cihaz detayı için bir migration çıkacak (§9.7).
