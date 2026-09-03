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
};

export default nextConfig;
