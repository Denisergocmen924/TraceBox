import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fly'da Docker ile çalışacak: standalone çıktı, node_modules'ün tamamını
  // değil yalnızca gerçekten kullanılan dosyaları imaja koyar (küçük imaj,
  // hızlı soğuk açılış — §9.12'deki uyku notu bu yüzden önemli).
  output: "standalone",

  // Next 16, `next dev` her açılışta AGENTS.md + CLAUDE.md üretiyor. Kapatıldı:
  // bu projenin tek doğruluk kaynağı kökteki CLAUDE.md (md/ARCHITECTURE.md
  // symlink'i). Alt klasörde ikinci bir CLAUDE.md, harness tarafından da
  // otomatik yüklendiği için o tekliği sessizce bozardı.
  agentRules: false,

  // `next dev` varsayılan olarak yalnızca localhost kökenine hizmet eder;
  // aynı ağdaki başka bir cihaz (telefon) LAN adresiyle bağlandığında sayfanın
  // HMR ve RSC istekleri 403 döner ve ekran boş kalır. Bu liste o kökenleri de
  // kabul ettirir. Yalnızca geliştirme sunucusunu ilgilendirir — üretim
  // çıktısına girmez.
  // 192.168.* ev ağı, 172.20.10.* iPhone hotspot, 10.* Android hotspot.
  allowedDevOrigins: ["192.168.*.*", "172.20.10.*", "10.*.*.*"],

  // Fly her uygulamaya bir `.fly.dev` adresi verir ve bu kapatılamaz. Resmi adres
  // `tracebox.observer`; eski adres açık kalırsa kullanıcı orada yarım çalışan bir
  // kopyaya düşer (giriş ve okuma çalışır, collector'ın CORS listesinde olmadığı
  // için cihaz ekleme / hesap silme çalışmaz) ve Supabase redirect listesinden de
  // çıkarıldığı için e-posta bağlantıları o adrese dönemez.
  //
  // Yalnızca `Host` başlığı o adres olduğunda tetiklenir: localhost ve asıl alan
  // adı etkilenmez. 307 (geçici) bilerek seçildi — 308 tarayıcılarda süresiz
  // önbelleğe alınır, alan adı bir gün değişirse eski ziyaretçiler takılı kalırdı.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "tracebox-dashboard.fly.dev" }],
        destination: "https://tracebox.observer/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
