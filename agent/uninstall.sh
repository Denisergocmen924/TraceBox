#!/usr/bin/env bash
#
# TraceBox Agent — temiz kaldırma.
#
# Servisi durdurur, dosyaları ve yetkisiz kullanıcıyı siler. Cihaz anahtarı
# config.toml içinde durduğu için bu betik anahtarı da yok eder.
#
# İki yerden çağrılır: kullanıcı elle (sudo ./uninstall.sh) ve `delete` komutu.
# İkinci yol dolaylıdır — agent yetkisiz çalıştığı için bu betiği kendisi
# çağıramaz; state dizinine bir işaret dosyası bırakır, root tarafındaki
# tracebox-uninstall.path onu görüp betiği çalıştırır. O çağrıda soru soracak
# kimse yoktur, bu yüzden --yes ile onaysız da çalışır.

set -euo pipefail

SERVICE_NAME="tracebox-agent.service"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}"

# Kaldırmayı tetikleyen çift. Bu betik ÇOĞU ZAMAN tracebox-uninstall.service
# tarafından çalıştırılır — yani kendi birimini durdurmaya çalışmamalıdır.
UNINSTALL_SERVICE="tracebox-uninstall.service"
UNINSTALL_PATH_UNIT="tracebox-uninstall.path"
UNINSTALL_SERVICE_PATH="/etc/systemd/system/${UNINSTALL_SERVICE}"
UNINSTALL_PATH_UNIT_PATH="/etc/systemd/system/${UNINSTALL_PATH_UNIT}"
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
  printf '  - %s izleyicisi kaldırılacak\n' "${UNINSTALL_PATH_UNIT}"
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

  # İzleyici de kapatılır; işaret dosyası birazdan silinecek dizinde duruyor.
  systemctl disable --now "${UNINSTALL_PATH_UNIT}" >/dev/null 2>&1 || true
  say "izleyici kapatıldı: ${UNINSTALL_PATH_UNIT}"

  # DİKKAT: ${UNINSTALL_SERVICE} durdurulmaz. Bu betiği şu anda o birim
  # çalıştırıyor olabilir; `stop` demek kendi süreç ağacını öldürmek, yani
  # kaldırmayı tam ortasında yarıda kesmek olurdu. Birimin [Install] bölümü de
  # yok (yalnızca path unit tetikler), dolayısıyla disable edilecek bir bağ
  # zaten yok — unit dosyasını silmek yeterli.
else
  say "systemctl yok — atlandı"
fi

for unit_file in "${UNIT_PATH}" "${UNINSTALL_PATH_UNIT_PATH}" "${UNINSTALL_SERVICE_PATH}"; do
  if [[ -f "${unit_file}" ]]; then
    rm -f "${unit_file}"
    say "unit dosyası silindi: ${unit_file}"
  fi
done

if command -v systemctl >/dev/null 2>&1; then
  # daemon-reload çalışan birimi durdurmaz: systemd onu bellekte tutar, yani
  # bu betik kendi unit dosyası silindikten sonra da sorunsuz devam eder.
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
