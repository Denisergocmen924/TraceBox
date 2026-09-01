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

# `delete` komutunun root tarafı. Agent yetkisiz çalıştığı için kendi kurulumunu
# kaldıramaz; yapabildiği tek şey state dizinine bir işaret dosyası bırakmaktır.
# Aşağıdaki path unit'i o dosyayı görür ve kaldırma servisini root olarak
# çalıştırır.
UNINSTALL_SERVICE="tracebox-uninstall.service"
UNINSTALL_PATH_UNIT="tracebox-uninstall.path"
UNINSTALL_SERVICE_PATH="/etc/systemd/system/${UNINSTALL_SERVICE}"
UNINSTALL_PATH_UNIT_PATH="/etc/systemd/system/${UNINSTALL_PATH_UNIT}"
DELETED_MARKER="${STATE_DIR}/deleted"
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
  printf '\n    rolling back the unfinished installation...\n' >&2
  local i
  for (( i = ${#ROLLBACK[@]} - 1; i >= 0; i-- )); do
    eval "${ROLLBACK[i]}" >/dev/null 2>&1 || true
  done
  printf '    the system is back to its pre-install state.\n' >&2
}

fail() {
  printf '\n✗ %s\n' "$*" >&2
  run_rollback
  (( ROLLBACK_ENABLED )) || printf '\n  The configuration was kept. To remove it: sudo %s/uninstall.sh\n' "${INSTALL_DIR}" >&2
  exit 1
}

on_error() { fail "Installation failed on line ${1}."; }
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
    [[ -n "${value}" ]] || printf '    cannot be empty, try again\n' > "${TTY_DEVICE}"
  done
  printf '%s' "${value}"
}

ask_yes_no() {
  local answer=""
  printf '    %s [y/N] ' "$1" > "${TTY_DEVICE}"
  read -r answer < "${TTY_DEVICE}"
  [[ "${answer}" == "y" || "${answer}" == "Y" ]]
}

run_as_service_user() {
  if have runuser; then
    runuser -u "${SERVICE_USER}" -- "$@"
  else
    su -s /bin/sh "${SERVICE_USER}" -c "$(printf '%q ' "$@")"
  fi
}

printf '\nTraceBox Agent installer\n'

# ===========================================================================
# 1/7  Ön kontrol — eksik bir şey varsa HİÇBİR ŞEY oluşturmadan dur.
# ===========================================================================
step "1/7  Preflight checks"

[[ ${EUID} -eq 0 ]] || fail "Root privileges are required. Run it like this: sudo bash install.sh"
[[ "$(uname -s)" == "Linux" ]] || fail "TraceBox Agent runs on Linux only (found: $(uname -s))."

# systemd'nin init olarak çalıştığının standart göstergesi bu dizindir.
[[ -d /run/systemd/system ]] || fail "systemd not found; the agent runs as a systemd service."
have systemctl || fail "systemctl not found."
have journalctl || fail "journalctl not found; the agent reads system logs from journald."
have useradd || fail "useradd not found; the unprivileged service user cannot be created."
have tar || fail "tar not found; the source archive cannot be extracted."
[[ -e "${TTY_DEVICE}" ]] || fail "No terminal access. The device key is asked for interactively; run the script from a terminal."

if have curl; then
  DOWNLOADER="curl"
elif have wget; then
  DOWNLOADER="wget"
else
  fail "curl or wget is required; the agent source cannot be downloaded."
fi

have python3 || fail "python3 not found; 3.11 or newer is required."
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
  || fail "This python3 is too old ($(python3 -V 2>&1)); 3.11 or newer is required."

# venv ve ensurepip Debian/Ubuntu'da ayrı bir pakettedir; eksikse izole ortam
# kurulamaz ve bu ancak 4. adımda patlardı.
python3 -c 'import venv, ensurepip' >/dev/null 2>&1 \
  || fail "The python3 venv module is missing. On Debian/Ubuntu: sudo apt install python3-venv"

if [[ -d "${INSTALL_DIR}" || -e "${UNIT_PATH}" ]]; then
  say "existing installation found — the code and the service will be refreshed"
fi

say "environment is suitable ($(python3 -V 2>&1), ${DOWNLOADER})"

# ===========================================================================
# 2/7  Kaynak — betik tek başına indirildiği için agent kodunu kendisi çeker.
# ===========================================================================
step "2/7  Downloading the agent source"

WORK_DIR="$(mktemp -d)"
TARBALL="${WORK_DIR}/source.tar.gz"
SOURCE_ROOT="${WORK_DIR}/src"

say "${REPO} @ ${REF}"
case "${DOWNLOADER}" in
  curl)
    # --proto '=https': yönlendirme düz HTTP'ye düşerse indirme reddedilir.
    curl -fsSL --proto '=https' --tlsv1.2 -o "${TARBALL}" "${SOURCE_URL}" \
      || fail "Could not download the source: ${SOURCE_URL}"
    ;;
  wget)
    wget -q --https-only -O "${TARBALL}" "${SOURCE_URL}" \
      || fail "Could not download the source: ${SOURCE_URL}"
    ;;
esac

mkdir -p "${SOURCE_ROOT}"
# --strip-components=1: arşivin en üstündeki "TraceBox-master/" sarmalı atılır.
tar -xzf "${TARBALL}" -C "${SOURCE_ROOT}" --strip-components=1 \
  || fail "Could not extract the source archive."

SOURCE_AGENT="${SOURCE_ROOT}/agent"
for required in \
  "__main__.py" "requirements.txt" \
  "tracebox-agent.service" "tracebox-uninstall.service" "tracebox-uninstall.path"
do
  [[ -f "${SOURCE_AGENT}/${required}" ]] \
    || fail "The downloaded archive is incomplete: agent/${required} is missing."
done

say "downloaded and extracted"

# ===========================================================================
# 3/7  Kullanıcı, dizinler ve kodun yerleştirilmesi
# ===========================================================================
step "3/7  User and directories"

if id "${SERVICE_USER}" >/dev/null 2>&1; then
  say "user already exists: ${SERVICE_USER}"
else
  NOLOGIN_SHELL="$(command -v nologin || true)"
  [[ -n "${NOLOGIN_SHELL}" ]] || NOLOGIN_SHELL="/bin/false"
  # --system: normal kullanıcı aralığının dışında bir UID; --no-create-home:
  # ev dizini yok. Bu hesapla oturum açılamaz, yalnızca servis çalışır.
  useradd --system --no-create-home --shell "${NOLOGIN_SHELL}" "${SERVICE_USER}"
  add_rollback "userdel ${SERVICE_USER}"
  say "unprivileged user created: ${SERVICE_USER}"
fi

# journald'ı okuyabilmek için gereken TEK ek yetki. root değil, grup üyeliği.
if getent group systemd-journal >/dev/null 2>&1; then
  usermod -aG systemd-journal "${SERVICE_USER}"
  say "added to the systemd-journal group (log read permission)"
else
  warn "no systemd-journal group; the agent can only see its own logs"
fi

for dir in "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}"; do
  if [[ ! -d "${dir}" ]]; then
    mkdir -p "${dir}"
    add_rollback "rm -rf ${dir}"
    say "created: ${dir}"
  fi
done

# Önceki kurulum `delete` ile bitmişse geride kaldırma işareti kalmış olabilir.
# Silinmeden path unit etkinleştirilirse, yeni kurulum daha ayağa kalkmadan
# kendini kaldırır.
if [[ -e "${DELETED_MARKER}" ]]; then
  rm -f "${DELETED_MARKER}"
  say "removal marker left from a previous installation deleted"
fi

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
  say "uninstall script: ${INSTALL_DIR}/uninstall.sh"
fi

say "code installed: ${INSTALL_DIR}/agent"

# ===========================================================================
# 4/7  İzole Python ortamı — sistem Python'ına hiç dokunulmaz.
# ===========================================================================
step "4/7  Isolated Python environment"

rm -rf "${VENV_DIR}"
python3 -m venv "${VENV_DIR}" || fail "Could not create the virtual environment: ${VENV_DIR}"

"${VENV_DIR}/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 \
  || warn "could not upgrade pip; continuing with the current version"
"${VENV_DIR}/bin/pip" install --quiet -r "${INSTALL_DIR}/agent/requirements.txt" \
  || fail "Could not install the dependencies (is there network access?)."

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

say "psutil + httpx installed (the system Python was left untouched)"

# ===========================================================================
# 5/7  Yapılandırma — cihaz anahtarı burada sorulur.
# ===========================================================================
step "5/7  Configuration"

WRITE_CONFIG=1
if [[ -f "${CONFIG_FILE}" ]]; then
  say "existing configuration found: ${CONFIG_FILE}"
  if ask_yes_no "Keep it? (answering no asks for the device key again)"; then
    WRITE_CONFIG=0
    say "existing configuration kept"
  fi
fi

if (( WRITE_CONFIG )); then
  COLLECTOR_URL="$(prompt_default "Collector address" "${DEFAULT_COLLECTOR_URL}")"
  DEVICE_KEY="$(prompt_secret "Device key (shown once in the dashboard)")"

  [[ "${DEVICE_KEY}" == "${KEY_PREFIX}"* ]] \
    || warn "the key does not start with '${KEY_PREFIX}' — make sure you pasted the right value"

  # Dosya İÇERİK yazılmadan önce kilitlenir: anahtar bir an bile başkalarının
  # okuyabileceği bir dosyada durmasın.
  : > "${CONFIG_FILE}"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_FILE}"
  chmod 600 "${CONFIG_FILE}"

  cat > "${CONFIG_FILE}" <<TOML
# TraceBox Agent configuration — generated by install.sh.
# The agent only reads this file, and re-reads it on every tick: changes take
# effect without restarting the service.
# Every option is documented in: ${INSTALL_DIR}/agent/config.example.toml

collector_url = "${COLLECTOR_URL}"
device_key    = "${DEVICE_KEY}"

collect_interval_seconds = 5
send_interval_seconds    = 10
command_poll_seconds     = 10

flush_cpu_threshold    = 90
flush_ram_threshold    = 90
flush_disk_threshold   = 95
flush_cooldown_seconds = 10

spool_max_age_days = 10
spool_max_size_mb  = 200

enabled_addons = []
TOML

  say "written: ${CONFIG_FILE} (owner ${SERVICE_USER}, mode 600)"
fi

# Bu noktadan sonra geri alma KAPATILIR. config.toml silinirse cihaz anahtarı
# kaybolur: sunucuda yalnızca SHA-256 özeti var, düz hali bir daha gösterilmez.
# Sonraki adımlarda bir hata olursa kurulum olduğu yerde bırakılır ve kullanıcı
# tekrar deneyebilir.
ROLLBACK_ENABLED=0

# ===========================================================================
# 6/7  systemd servisi
# ===========================================================================
step "6/7  systemd service"

install -m 644 "${INSTALL_DIR}/agent/tracebox-agent.service" "${UNIT_PATH}"
install -m 644 "${INSTALL_DIR}/agent/${UNINSTALL_SERVICE}" "${UNINSTALL_SERVICE_PATH}"
install -m 644 "${INSTALL_DIR}/agent/${UNINSTALL_PATH_UNIT}" "${UNINSTALL_PATH_UNIT_PATH}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
systemctl restart "${SERVICE_NAME}"

say "installed and started: ${SERVICE_NAME}"

# İzleyici şimdi başlar ve kaldırma işaretini beklemeye koyulur. `enable --now`
# olmadan yalnızca bir sonraki açılışta devreye girerdi: bu makinede verilen
# ilk `delete` komutu, makine yeniden başlatılana kadar tamamlanmazdı.
systemctl enable --now "${UNINSTALL_PATH_UNIT}" >/dev/null 2>&1 \
  || warn "could not enable ${UNINSTALL_PATH_UNIT}; a delete command would then need manual removal"
say "removal watcher enabled: ${UNINSTALL_PATH_UNIT} (the root side of the delete command)"

# Servisin ilk saniyede düşüp düşmediğini görmek için kısa bir bekleme.
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  say "service is running"
else
  warn "the service did not come up — details: journalctl -u ${SERVICE_NAME} -n 30 --no-pager"
fi

# ===========================================================================
# 7/7  Bağlantı testi — GET /verify
# ===========================================================================
step "7/7  Connection test"

# Test, servisin çalıştığı kullanıcıyla yapılır: config'i okuyabildiği de
# böylece doğrulanmış olur.
VERIFY_OK=1
( cd "${INSTALL_DIR}" && run_as_service_user "${VENV_DIR}/bin/python" -m agent --verify ) \
  || VERIFY_OK=0

printf '\n'
if (( VERIFY_OK )); then
  printf '✓ TraceBox Agent is installed and talking to the collector.\n\n'
else
  printf '! TraceBox Agent is installed but the connection test failed.\n'
  printf '  Fix the configuration and try again:\n'
  printf '    sudo nano %s\n' "${CONFIG_FILE}"
  printf '    sudo -u %s %s/bin/python -m agent --verify   (from inside %s)\n\n' \
    "${SERVICE_USER}" "${VENV_DIR}" "${INSTALL_DIR}"
fi

printf '  Status   : systemctl status %s\n' "${SERVICE_NAME}"
printf '  Logs     : journalctl -u %s -f\n' "${SERVICE_NAME}"
printf '  Uninstall: sudo %s/uninstall.sh\n\n' "${INSTALL_DIR}"
