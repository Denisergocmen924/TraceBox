// Tailwind v4 artık PostCSS eklentisini ayrı bir pakette sunuyor.
// Ayar dosyası (tailwind.config.js) YOK — tema doğrudan CSS içinde,
// app/globals.css'teki @theme bloğunda tanımlı.
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
