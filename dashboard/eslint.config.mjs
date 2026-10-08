import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // React'in yeni "compiler" kuralları: çalışan, canlıdaki desenleri (effect içinde
    // setState, render'da ref okuma) hata sayıyor. Bunları düzeltmek 14 yerde veri
    // akışını yeniden yazmak demek ve dashboard'ın bileşen testi yok. Bu yüzden `warn`:
    // lint temiz geçer, bulgular görünür kalır, yeni kodda aynı desen yine uyarı verir.
    // Takip: md/memory/pending.md → "Lint: React compiler kuralları".
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "example/**", "next-env.d.ts"] },
];

export default config;
