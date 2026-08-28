import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fly'da Docker ile çalışacak: standalone çıktı, node_modules'ün tamamını
  // değil yalnızca gerçekten kullanılan dosyaları imaja koyar (küçük imaj,
  // hızlı soğuk açılış — §9.12'deki uyku notu bu yüzden önemli).
  output: "standalone",
};

export default nextConfig;
