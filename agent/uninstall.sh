#!/usr/bin/env bash
#
# TraceBox Agent — temiz kaldırma.
#
# Servisi durdurur, dosyaları ve yetkisiz kullanıcıyı siler. Cihaz anahtarı
# config.toml içinde durduğu için bu betik anahtarı da yok eder.
#
# İki yerden çağrılır: kullanıcı elle (sudo ./uninstall.sh) ve M6'daki `delete`
# komutu (self-uninstall). O yüzden --yes ile soru sormadan da çalışabilir.

set -euo pipefail

SERVICE_NAME="tracebox-agent.service"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}"
INSTALL_DIR="/opt/tracebox"
CONFIG_DIR="/etc/tracebox"
STATE_DIR="/var/lib/tracebox"
SERVICE_USER="tracebox"

say()  { printf '  %s\n' "$*"; }
step() { printf '\n▸ %s\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# --- Ön koşullar -----------------------------------------------------------

[[ ${EUID} -eq 0 ]] || fail "Bu betik root yetkisi ister: sudo ./uninstall.sh"

# --yes verilmediyse onay iste. Silinen şeyler geri getirilemez (anahtar dahil).
if [[ "${1:-}" != "--yes" ]]; then
  printf 'TraceBox Agent kaldırılacak:\n'
  printf '  - %s durdurulup devre dışı bırakılacak\n' "${SERVICE_NAME}"
  printf '  - %s, %s, %s silinecek\n' "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}"
  printf '  - %s kullanıcısı silinecek\n' "${SERVICE_USER}"
  printf '\nCihaz anahtarı da silinir; cihazı tekrar eklemek için yeni anahtar gerekir.\n'
  read -r -p 'Devam edilsin mi? [e/H] ' answer
  [[ "${answer}" == "e" || "${answer}" == "E" ]] || fail "İptal edildi."
fi

# --- 1) Servisi durdur -----------------------------------------------------
# Dosyalardan ÖNCE durdurulur: yoksa systemd, kodu silinmiş bir servisi
# Restart=on-failure ile yeniden başlatmayı dener.

step "Servis durduruluyor"
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  say "durduruldu ve devre dışı bırakıldı"
else
  say "systemctl yok — atlandı"
fi

if [[ -f "${UNIT_PATH}" ]]; then
  rm -f "${UNIT_PATH}"
  say "unit dosyası silindi: ${UNIT_PATH}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  # Durdurulmuş servisin `failed` kaydı systemctl listesinde kalmasın.
  systemctl reset-failed "${SERVICE_NAME}" >/dev/null 2>&1 || true
fi

# --- 2) Dosyaları sil ------------------------------------------------------

step "Dosyalar siliniyor"
for path in "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}"; do
  if [[ -e "${path}" ]]; then
    rm -rf "${path}"
    say "silindi: ${path}"
  else
    say "zaten yok: ${path}"
  fi
done

# --- 3) Kullanıcıyı sil ----------------------------------------------------
# En sona bırakılır: kullanıcı hâlâ varken dosya sahipliği tutarlı kalır ve
# servis durmadan userdel zaten başarısız olurdu.

step "Kullanıcı siliniyor"
if id "${SERVICE_USER}" >/dev/null 2>&1; then
  if userdel "${SERVICE_USER}" 2>/dev/null; then
    say "silindi: ${SERVICE_USER}"
  else
    say "UYARI: ${SERVICE_USER} silinemedi (kullanıcıya ait süreç kalmış olabilir)"
  fi
else
  say "zaten yok: ${SERVICE_USER}"
fi

printf '\n✓ TraceBox Agent kaldırıldı.\n'
