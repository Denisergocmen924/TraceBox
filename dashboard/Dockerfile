# =============================================================================
# TraceBox Dashboard — container image.
#
# Collector'dan AYRI bir Fly app (CLAUDE.md §9.1). Bu imajın tek işi JS/HTML
# SUNMAK: veri çekilmiyor, hiçbir istek buradan Supabase'e gitmiyor. Sunucu
# tarafında sır YOK — tarayıcı Supabase'e kendi JWT'siyle bağlanıyor ve RLS
# koruyor.
#
# Üç aşama: bağımlılıklar → derleme → çalıştırma. Son imaja yalnızca üçüncü
# aşama giriyor; npm önbelleği, kaynak kod ve devDependencies dışarıda kalıyor.
# =============================================================================

# --- 1) bağımlılıklar --------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Yalnızca manifest kopyalanıyor: kaynak kod değiştiğinde bu katman
# önbellekten geliyor ve `npm ci` yeniden çalışmıyor.
COPY package.json package-lock.json ./

# `npm ci` (install değil): lock dosyasına birebir uyar ve uymuyorsa hata
# verir. Derlemenin, yerelde denenmemiş bir sürümle sessizce ilerlemesi
# imkânsız olmalı.
RUN npm ci

# --- 2) derleme --------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* değişkenleri DERLEME ANINDA koda gömülür; çalışma zamanı
# ortam değişkeni olarak verilemezler. Bu yüzden Fly secret DEĞİL, build-arg
# olarak geliyorlar — `fly.toml` → [build.args].
#
# Üçü de tarayıcıya inen, herkesin görebileceği değerler (bkz. .env.example):
# anon key'in tek yetkisi "RLS'e tabi bir istemciyim" demek. SIR olan
# SUPABASE_SERVICE_KEY buraya ASLA girmez; o yalnızca collector'ın Fly
# secret'ıdır.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_COLLECTOR_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_COLLECTOR_URL=$NEXT_PUBLIC_COLLECTOR_URL

# Eksik bir build-arg SESSİZCE geçmemeli. `next build` bu değerler olmadan da
# başarıyla biter — çünkü Supabase istemcisi ilk çağrıda, yani TARAYICIDA
# kuruluyor. Sonuç, deploy'un yeşil göründüğü ama açan herkesin boş bir ekran
# ve konsolda "Missing environment variable" gördüğü bir imaj olurdu.
# Derlemeyi burada, hâlâ ucuzken durduruyoruz.
RUN for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_COLLECTOR_URL; do \
      eval "value=\$$v"; \
      if [ -z "$value" ]; then \
        echo "HATA: $v bos. fly.toml icindeki [build.args] bolumunu doldurun."; \
        exit 1; \
      fi; \
    done

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- 3) çalıştırma -----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# HOSTNAME: Next'in standalone sunucusu varsayılanda localhost'a bağlanır; o
# hâlde container dışından, yani Fly proxy'sinden erişilemezdi.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `output: "standalone"` (next.config.ts) yalnızca gerçekten import edilen
# modülleri toplayıp yanına küçük bir sunucu koyuyor — node_modules'ün tamamı
# imaja girmiyor. Küçük imaj = hızlı soğuk açılış; aşağıdaki uyku kararı
# (fly.toml) bunun üstüne kurulu.
COPY --from=builder --chown=node:node /app/.next/standalone ./
# static ve public standalone çıktısının DIŞINDA kalır; ayrıca kopyalanmazsa
# sayfa açılır ama CSS'siz ve logosuz gelir.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# next/image, istenen boyutu ÇALIŞMA ZAMANINDA üretip .next/cache/images
# altına yazıyor. Dizin yoksa ve yazılamıyorsa logo sessizce kırık gelir —
# yetkisiz kullanıcıya geçmeden önce açılıp devrediliyor.
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next

# Yetkisiz kullanıcı. node imajında hazır bir `node` kullanıcısı var; ayrıca
# açmaya gerek yok.
USER node

EXPOSE 3000

CMD ["node", "server.js"]
