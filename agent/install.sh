#!/usr/bin/env bash
#
# TraceBox Agent — kurulum.
#
# Kullanım (root gerekir):
#   curl -fsSL https://raw.githubusercontent.com/Denisergocmen924/TraceBox/master/agent/install.sh -o install.sh
#   less install.sh          # çalıştırmadan önce okuyun
#   sudo bash install.sh
#
# Betik tek başına indirilebilir; agent kaynağını kendisi çeker.
#
# Cihaz anahtarı komut satırından DEĞİL, çalışma sırasında sorularak alınır:
# argüman olarak verilse kabuk geçmişine ve `ps` çıktısına düşerdi.

set -Eeuo pipefail

# --- Ayarlar ---------------------------------------------------------------
# Fork ya da farklı bir dal ile kurmak için: TRACEBOX_REPO / TRACEBOX_REF.
REPO="${TRACEBOX_REPO:-Denisergocmen924/TraceBox}"
REF="${TRACEBOX_REF:-master}"
SOURCE_URL="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"

DEFAULT_COLLECTOR_URL="https://tracebox-collector.fly.dev"
KEY_PREFIX="tbx_live_"

INSTALL_DIR="/opt/tracebox"
VENV_DIR="${INSTALL_DIR}/venv"
CONFIG_DIR="/etc/tracebox"
CONFIG_FILE="${CONFIG_DIR}/config.toml"
STATE_DIR="/var/lib/tracebox"
SERVICE_USER="tracebox"
SERVICE_NAME="tracebox-agent.service"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}"
TTY_DEVICE="/dev/tty"

# --- Çıktı yardımcıları ----------------------------------------------------

step() { printf '\n▸ %s\n' "$*"; }
say()  { printf '    %s\n' "$*"; }
warn() { printf '    ! %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- Geri alma (rollback) --------------------------------------------------
# Yarım kurulum bırakılmaz: oluşturulan her şey bir geri alma komutu olarak
# kaydedilir ve hata durumunda TERS sırayla çalıştırılır.

ROLLBACK=()
ROLLBACK_ENABLED=1
WORK_DIR=""

add_rollback() { ROLLBACK+=("$1"); }

run_rollback() {
  (( ROLLBACK_ENABLED )) || return 0
  (( ${#ROLLBACK[@]} )) || return 0
  printf '\n    yarım kalan kurulum geri alınıyor...\n' >&2
  local i
  for (( i = ${#ROLLBACK[@]} - 1; i >= 0; i-- )); do
    eval "${ROLLBACK[i]}" >/dev/null 2>&1 || true
  done
  printf '    sistem kurulum öncesi haline döndürüldü.\n' >&2
}

fail() {
  printf '\n✗ %s\n' "$*" >&2
  run_rollback
  (( ROLLBACK_ENABLED )) || printf '\n  Yapılandırma korundu. Kaldırmak için: sudo %s/uninstall.sh\n' "${INSTALL_DIR}" >&2
  exit 1
}

on_error() { fail "Kurulum ${1} numaralı satırda başarısız oldu."; }
trap 'on_error ${LINENO}' ERR

# İndirme için açılan geçici dizin her durumda silinir.
trap '[[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]] && rm -rf "${WORK_DIR}" || true' EXIT

# --- Terminalden okuma -----------------------------------------------------
# Girdiler stdin'den DEĞİL doğrudan terminalden okunur; böylece betik
# `curl ... | sudo bash` ile boruya bağlı çalıştırıldığında da sorular sorulabilir
# (o durumda stdin betiğin kendi metnidir).

prompt_default() {
  local label="$1" default="$2" value=""
  printf '    %s [%s]: ' "${label}" "${default}" > "${TTY_DEVICE}"
  read -r value < "${TTY_DEVICE}"
  printf '%s' "${value:-${default}}"
}

prompt_secret() {
  local label="$1" value=""
  while [[ -z "${value}" ]]; do
    printf '    %s: ' "${label}" > "${TTY_DEVICE}"
    # -s: yazılan karakterler ekranda görünmez (omuz üstünden okunmasın).
    read -r -s value < "${TTY_DEVICE}"
    printf '\n' > "${TTY_DEVICE}"
    [[ -n "${value}" ]] || printf '    boş olamaz, tekrar deneyin\n' > "${TTY_DEVICE}"
  done
  printf '%s' "${value}"
}

ask_yes_no() {
  local answer=""
  printf '    %s [e/H] ' "$1" > "${TTY_DEVICE}"
  read -r answer < "${TTY_DEVICE}"
  [[ "${answer}" == "e" || "${answer}" == "E" ]]
}

run_as_service_user() {
  if have runuser; then
    runuser -u "${SERVICE_USER}" -- "$@"
  else
    su -s /bin/sh "${SERVICE_USER}" -c "$(printf '%q ' "$@")"
  fi
}

printf '\nTraceBox Agent kurulumu\n'

# ===========================================================================
# 1/7  Ön kontrol — eksik bir şey varsa HİÇBİR ŞEY oluşturmadan dur.
# ===========================================================================
step "1/7  Ön kontrol"

[[ ${EUID} -eq 0 ]] || fail "root yetkisi gerekli. Şöyle çalıştırın: sudo bash install.sh"
[[ "$(uname -s)" == "Linux" ]] || fail "TraceBox Agent yalnızca Linux'ta çalışır (bulunan: $(uname -s))."

# systemd'nin init olarak çalıştığının standart göstergesi bu dizindir.
[[ -d /run/systemd/system ]] || fail "systemd bulunamadı; agent bir systemd servisi olarak çalışır."
have systemctl || fail "systemctl bulunamadı."
have journalctl || fail "journalctl bulunamadı; agent sistem loglarını journald'dan okur."
have useradd || fail "useradd bulunamadı; yetkisiz servis kullanıcısı oluşturulamaz."
have tar || fail "tar bulunamadı; kaynak arşivi açılamaz."
[[ -e "${TTY_DEVICE}" ]] || fail "Terminal erişimi yok. Cihaz anahtarı sorularak alınır; betiği bir terminalden çalıştırın."

if have curl; then
  DOWNLOADER="curl"
elif have wget; then
  DOWNLOADER="wget"
else
  fail "curl veya wget gerekli; agent kaynağı indirilemez."
fi

have python3 || fail "python3 bulunamadı; en az 3.11 gerekli."
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
  || fail "python3 sürümü çok eski ($(python3 -V 2>&1)); en az 3.11 gerekli."

# venv ve ensurepip Debian/Ubuntu'da ayrı bir pakettedir; eksikse izole ortam
# kurulamaz ve bu ancak 4. adımda patlardı.
python3 -c 'import venv, ensurepip' >/dev/null 2>&1 \
  || fail "python3 venv modülü eksik. Debian/Ubuntu'da: sudo apt install python3-venv"

if [[ -d "${INSTALL_DIR}" || -e "${UNIT_PATH}" ]]; then
  say "mevcut kurulum bulundu — kod ve servis yenilenecek"
fi

say "ortam uygun ($(python3 -V 2>&1), ${DOWNLOADER})"

# ===========================================================================
# 2/7  Kaynak — betik tek başına indirildiği için agent kodunu kendisi çeker.
# ===========================================================================
step "2/7  Agent kaynağı indiriliyor"

WORK_DIR="$(mktemp -d)"
TARBALL="${WORK_DIR}/source.tar.gz"
SOURCE_ROOT="${WORK_DIR}/src"

say "${REPO} @ ${REF}"
case "${DOWNLOADER}" in
  curl)
    # --proto '=https': yönlendirme düz HTTP'ye düşerse indirme reddedilir.
    curl -fsSL --proto '=https' --tlsv1.2 -o "${TARBALL}" "${SOURCE_URL}" \
      || fail "Kaynak indirilemedi: ${SOURCE_URL}"
    ;;
  wget)
    wget -q --https-only -O "${TARBALL}" "${SOURCE_URL}" \
      || fail "Kaynak indirilemedi: ${SOURCE_URL}"
    ;;
esac

mkdir -p "${SOURCE_ROOT}"
# --strip-components=1: arşivin en üstündeki "TraceBox-master/" sarmalı atılır.
tar -xzf "${TARBALL}" -C "${SOURCE_ROOT}" --strip-components=1 \
  || fail "Kaynak arşivi açılamadı."

SOURCE_AGENT="${SOURCE_ROOT}/agent"
for required in "__main__.py" "requirements.txt" "tracebox-agent.service"; do
  [[ -f "${SOURCE_AGENT}/${required}" ]] \
    || fail "İndirilen arşiv eksik: agent/${required} yok."
done

say "indirildi ve açıldı"

# ===========================================================================
# 3/7  Kullanıcı, dizinler ve kodun yerleştirilmesi
# ===========================================================================
step "3/7  Kullanıcı ve dizinler"

if id "${SERVICE_USER}" >/dev/null 2>&1; then
  say "kullanıcı zaten var: ${SERVICE_USER}"
else
  NOLOGIN_SHELL="$(command -v nologin || true)"
  [[ -n "${NOLOGIN_SHELL}" ]] || NOLOGIN_SHELL="/bin/false"
  # --system: normal kullanıcı aralığının dışında bir UID; --no-create-home:
  # ev dizini yok. Bu hesapla oturum açılamaz, yalnızca servis çalışır.
  useradd --system --no-create-home --shell "${NOLOGIN_SHELL}" "${SERVICE_USER}"
  add_rollback "userdel ${SERVICE_USER}"
  say "yetkisiz kullanıcı oluşturuldu: ${SERVICE_USER}"
fi

# journald'ı okuyabilmek için gereken TEK ek yetki. root değil, grup üyeliği.
if getent group systemd-journal >/dev/null 2>&1; then
  usermod -aG systemd-journal "${SERVICE_USER}"
  say "systemd-journal grubuna eklendi (log okuma izni)"
else
  warn "systemd-journal grubu yok; agent yalnızca kendi loglarını görebilir"
fi

for dir in "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}"; do
  if [[ ! -d "${dir}" ]]; then
    mkdir -p "${dir}"
    add_rollback "rm -rf ${dir}"
    say "oluşturuldu: ${dir}"
  fi
done

# Kod her kurulumda sıfırdan kopyalanır: eski sürümden kalan bir dosya
# yenisinin yanında durmasın.
rm -rf "${INSTALL_DIR}/agent"
cp -R "${SOURCE_AGENT}" "${INSTALL_DIR}/agent"
find "${INSTALL_DIR}/agent" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
# Kurulum betikleri hedef makinede kod ağacının içinde durmaz.
rm -f "${INSTALL_DIR}/agent/install.sh" "${INSTALL_DIR}/agent/uninstall.sh"

# Kaldırma betiği bilinen bir yere konur: kullanıcı elle çalıştırabilsin.
if [[ -f "${SOURCE_AGENT}/uninstall.sh" ]]; then
  install -m 755 "${SOURCE_AGENT}/uninstall.sh" "${INSTALL_DIR}/uninstall.sh"
  say "kaldırma betiği: ${INSTALL_DIR}/uninstall.sh"
fi

say "kod yerleştirildi: ${INSTALL_DIR}/agent"

# ===========================================================================
# 4/7  İzole Python ortamı — sistem Python'ına hiç dokunulmaz.
# ===========================================================================
step "4/7  İzole Python ortamı"

rm -rf "${VENV_DIR}"
python3 -m venv "${VENV_DIR}" || fail "Sanal ortam oluşturulamadı: ${VENV_DIR}"

"${VENV_DIR}/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 \
  || warn "pip güncellenemedi; mevcut sürümle devam ediliyor"
"${VENV_DIR}/bin/pip" install --quiet -r "${INSTALL_DIR}/agent/requirements.txt" \
  || fail "Bağımlılıklar kurulamadı (ağ erişimi var mı?)."

# Bytecode şimdi, root iken üretilir: /opt/tracebox agent'a salt-okunur olduğu
# için servis her açılışta yeniden derlemeye çalışıp başarısız olmasın.
"${VENV_DIR}/bin/python" -m compileall -q "${INSTALL_DIR}/agent" >/dev/null 2>&1 || true

# Kod root'a ait ve agent'a salt-okunur: agent kendi kodunu değiştiremez.
chown -R root:root "${INSTALL_DIR}"
chmod 755 "${INSTALL_DIR}"

# Agent'ın YAZDIĞI tek yer: state.json + spool.
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}"
chmod 750 "${STATE_DIR}"

# Config dizini: sahibi root, grubu tracebox, başkalarına kapalı.
chown root:"${SERVICE_USER}" "${CONFIG_DIR}"
chmod 750 "${CONFIG_DIR}"

say "psutil + httpx kuruldu (sistem Python'ı değişmedi)"

# ===========================================================================
# 5/7  Yapılandırma — cihaz anahtarı burada sorulur.
# ===========================================================================
step "5/7  Yapılandırma"

WRITE_CONFIG=1
if [[ -f "${CONFIG_FILE}" ]]; then
  say "mevcut yapılandırma bulundu: ${CONFIG_FILE}"
  if ask_yes_no "Korunsun mu? (hayır derseniz cihaz anahtarı yeniden sorulur)"; then
    WRITE_CONFIG=0
    say "mevcut yapılandırma korundu"
  fi
fi

if (( WRITE_CONFIG )); then
  COLLECTOR_URL="$(prompt_default "Collector adresi" "${DEFAULT_COLLECTOR_URL}")"
  DEVICE_KEY="$(prompt_secret "Cihaz anahtarı (dashboard'da bir kez gösterilir)")"

  [[ "${DEVICE_KEY}" == "${KEY_PREFIX}"* ]] \
    || warn "anahtar '${KEY_PREFIX}' ile başlamıyor — doğru değeri yapıştırdığınızdan emin olun"

  # Dosya İÇERİK yazılmadan önce kilitlenir: anahtar bir an bile başkalarının
  # okuyabileceği bir dosyada durmasın.
  : > "${CONFIG_FILE}"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_FILE}"
  chmod 600 "${CONFIG_FILE}"

  cat > "${CONFIG_FILE}" <<TOML
# TraceBox Agent yapılandırması — install.sh tarafından oluşturuldu.
# Agent bu dosyayı yalnızca okur ve her tick'te yeniden okur: değişiklikler
# servisi yeniden başlatmadan geçerli olur.
# Tüm seçeneklerin açıklaması: ${INSTALL_DIR}/agent/config.example.toml

collector_url = "${COLLECTOR_URL}"
device_key    = "${DEVICE_KEY}"

collect_interval_seconds = 5
send_interval_seconds    = 30
command_poll_seconds     = 10

flush_cpu_threshold    = 90
flush_ram_threshold    = 90
flush_disk_threshold   = 95
flush_cooldown_seconds = 20

spool_max_age_days = 10
spool_max_size_mb  = 200

enabled_addons = []
TOML

  say "yazıldı: ${CONFIG_FILE} (sahip ${SERVICE_USER}, izin 600)"
fi

# Bu noktadan sonra geri alma KAPATILIR. config.toml silinirse cihaz anahtarı
# kaybolur: sunucuda yalnızca SHA-256 özeti var, düz hali bir daha gösterilmez.
# Sonraki adımlarda bir hata olursa kurulum olduğu yerde bırakılır ve kullanıcı
# tekrar deneyebilir.
ROLLBACK_ENABLED=0

# ===========================================================================
# 6/7  systemd servisi
# ===========================================================================
step "6/7  systemd servisi"

install -m 644 "${INSTALL_DIR}/agent/tracebox-agent.service" "${UNIT_PATH}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
systemctl restart "${SERVICE_NAME}"

say "kuruldu ve başlatıldı: ${SERVICE_NAME}"

# Servisin ilk saniyede düşüp düşmediğini görmek için kısa bir bekleme.
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  say "servis çalışıyor"
else
  warn "servis ayağa kalkmadı — ayrıntı: journalctl -u ${SERVICE_NAME} -n 30 --no-pager"
fi

# ===========================================================================
# 7/7  Bağlantı testi — GET /verify
# ===========================================================================
step "7/7  Bağlantı testi"

# Test, servisin çalıştığı kullanıcıyla yapılır: config'i okuyabildiği de
# böylece doğrulanmış olur.
VERIFY_OK=1
( cd "${INSTALL_DIR}" && run_as_service_user "${VENV_DIR}/bin/python" -m agent --verify ) \
  || VERIFY_OK=0

printf '\n'
if (( VERIFY_OK )); then
  printf '✓ TraceBox Agent kuruldu ve collector ile konuşuyor.\n\n'
else
  printf '! TraceBox Agent kuruldu ama bağlantı testi başarısız.\n'
  printf '  Yapılandırmayı düzeltip tekrar deneyin:\n'
  printf '    sudo nano %s\n' "${CONFIG_FILE}"
  printf '    sudo -u %s %s/bin/python -m agent --verify   (%s içinden)\n\n' \
    "${SERVICE_USER}" "${VENV_DIR}" "${INSTALL_DIR}"
fi

printf '  Durum   : systemctl status %s\n' "${SERVICE_NAME}"
printf '  Loglar  : journalctl -u %s -f\n' "${SERVICE_NAME}"
printf '  Kaldırma: sudo %s/uninstall.sh\n\n' "${INSTALL_DIR}"
