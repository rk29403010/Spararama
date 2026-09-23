#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [ -z "${PREFIX:-}" ] || [[ "$PREFIX" != *com.termux* ]]; then
  echo 'This HTTPS setup command must be run inside Termux on Android.' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/spararama/phone.conf"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/spararama-phone"
CADDYFILE="${XDG_CONFIG_HOME:-$HOME/.config}/spararama/Caddyfile"
SERVICE_DIR="$PREFIX/var/service/spararama-caddy"

usage() {
  cat <<'EOF'
Usage:
  spar https-setup internal HOST [PORT]
  spar https-setup external HOST CERT_FILE KEY_FILE [PORT]
  spar https-off

internal: local Caddy CA for a private LAN. Client devices must trust Caddy's
internal CA. It is not a Google OAuth production origin.

external: serve a real hostname with an externally provisioned certificate and
private key. Obtain/renew that certificate separately (normally DNS-01); Caddy
in the standard Termux package has no DNS-provider module configured here.
EOF
}

persist() {
  local key="$1" value="$2" tmp="$CONFIG_FILE.tmp"
  mkdir -p "$(dirname "$CONFIG_FILE")"
  touch "$CONFIG_FILE"
  grep -v "^${key}=" "$CONFIG_FILE" > "$tmp" || true
  printf '%s=%q\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

disable_https() {
  persist SPAR_HTTPS_ENABLED 0
  persist SPAR_BIND_HOST 127.0.0.1
  if command -v sv >/dev/null 2>&1; then sv down "$SERVICE_DIR" >/dev/null 2>&1 || true; fi
  rm -rf "$SERVICE_DIR"
  echo 'HTTPS disabled. Spararama will return to loopback-only HTTP after: spar restart'
}

[ "$#" -ge 1 ] || { usage >&2; exit 2; }
case "$1" in
  off) disable_https; exit 0 ;;
  internal)
    [ "$#" -ge 2 ] && [ "$#" -le 3 ] || { usage >&2; exit 2; }
    SPAR_HTTPS_MODE=internal SPAR_HTTPS_HOST="$2" SPAR_HTTPS_PORT="${3:-8443}" SPAR_TLS_CERT_FILE='' SPAR_TLS_KEY_FILE=''
    ;;
  external)
    [ "$#" -ge 4 ] && [ "$#" -le 5 ] || { usage >&2; exit 2; }
    SPAR_HTTPS_MODE=external SPAR_HTTPS_HOST="$2" SPAR_TLS_CERT_FILE="$3" SPAR_TLS_KEY_FILE="$4" SPAR_HTTPS_PORT="${5:-8443}"
    [ -r "$SPAR_TLS_CERT_FILE" ] && [ -r "$SPAR_TLS_KEY_FILE" ] || { echo 'Certificate or key is not readable by Termux.' >&2; exit 1; }
    ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

SPAR_HTTPS_ENABLED=1
SPAR_PORT="${SPAR_PORT:-3000}"
SPAR_CADDY_LOG_FILE="$STATE_DIR/caddy.log"
SPAR_CADDY_SERVICE_LOG_FILE="$STATE_DIR/caddy-service.log"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/https-config.sh"
spar_https_validate

command -v caddy >/dev/null 2>&1 || { echo 'Caddy is not installed. Run: pkg install caddy termux-services' >&2; exit 1; }
command -v sv >/dev/null 2>&1 || { echo 'termux-services is not available. Run: pkg install termux-services' >&2; exit 1; }

mkdir -p "$STATE_DIR" "$(dirname "$CONFIG_FILE")" "$(dirname "$CADDYFILE")"
BACKUP_DIR="$(mktemp -d "$STATE_DIR/https-setup.XXXXXX")"
CANDIDATE_CADDYFILE="$BACKUP_DIR/Caddyfile.candidate"
OLD_CONFIG_EXISTS=0
OLD_CADDYFILE_EXISTS=0
OLD_SERVICE_EXISTS=0
OLD_SERVICE_UP=0
SETUP_COMPLETE=0

if [ -f "$CONFIG_FILE" ]; then
  cp -p "$CONFIG_FILE" "$BACKUP_DIR/phone.conf"
  OLD_CONFIG_EXISTS=1
fi
if [ -f "$CADDYFILE" ]; then
  cp -p "$CADDYFILE" "$BACKUP_DIR/Caddyfile"
  OLD_CADDYFILE_EXISTS=1
fi
if [ -d "$SERVICE_DIR" ]; then
  OLD_SERVICE_EXISTS=1
  if [ -f "$SERVICE_DIR/run" ]; then cp -p "$SERVICE_DIR/run" "$BACKUP_DIR/service-run"; fi
  if sv status "$SERVICE_DIR" 2>/dev/null | grep -q '^run:'; then OLD_SERVICE_UP=1; fi
fi

rollback() {
  local status=$?
  trap - EXIT
  if [ "$status" -eq 0 ] && [ "$SETUP_COMPLETE" -eq 1 ]; then
    rm -rf "$BACKUP_DIR"
    return 0
  fi

  set +e
  echo 'HTTPS setup failed; restoring the previous configuration.' >&2

  if [ "$OLD_CONFIG_EXISTS" -eq 1 ]; then
    cp -p "$BACKUP_DIR/phone.conf" "$CONFIG_FILE"
  else
    rm -f "$CONFIG_FILE"
  fi
  if [ "$OLD_CADDYFILE_EXISTS" -eq 1 ]; then
    cp -p "$BACKUP_DIR/Caddyfile" "$CADDYFILE"
  else
    rm -f "$CADDYFILE"
  fi

  if [ "$OLD_SERVICE_EXISTS" -eq 1 ]; then
    mkdir -p "$SERVICE_DIR"
    if [ -f "$BACKUP_DIR/service-run" ]; then
      cp -p "$BACKUP_DIR/service-run" "$SERVICE_DIR/run"
      chmod 700 "$SERVICE_DIR/run"
    fi
    if [ "$OLD_SERVICE_UP" -eq 1 ]; then
      sv restart "$SERVICE_DIR" >/dev/null 2>&1 || sv up "$SERVICE_DIR" >/dev/null 2>&1 || true
    else
      sv down "$SERVICE_DIR" >/dev/null 2>&1 || true
    fi
  else
    sv down "$SERVICE_DIR" >/dev/null 2>&1 || true
    rm -rf "$SERVICE_DIR"
  fi

  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap rollback EXIT

# A valid Caddy configuration is necessary but not sufficient: an occupied port
# or runtime TLS problem is only visible after the service starts. Validate the
# candidate before touching the live files, then verify the real HTTPS endpoint.
spar_https_write_caddyfile "$CANDIDATE_CADDYFILE"
caddy validate --config "$CANDIDATE_CADDYFILE" --adapter caddyfile >/dev/null

if ! curl -fsS --max-time 3 "http://127.0.0.1:${SPAR_PORT}/api/health" >/dev/null; then
  echo "Spararama is not responding on loopback port ${SPAR_PORT}. Start it before configuring HTTPS." >&2
  exit 1
fi

cp "$CANDIDATE_CADDYFILE" "$CADDYFILE"
chmod 600 "$CADDYFILE"
if [ "$SPAR_HTTPS_MODE" = external ]; then chmod 600 "$SPAR_TLS_KEY_FILE"; fi

mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec '$PREFIX/bin/caddy' run --config '$CADDYFILE' --adapter caddyfile >> '$SPAR_CADDY_SERVICE_LOG_FILE' 2>&1
EOF
chmod 700 "$SERVICE_DIR/run"

if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
  # shellcheck disable=SC1090
  source "$PREFIX/etc/profile.d/start-services.sh"
fi

service_started=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if sv restart "$SERVICE_DIR" >/dev/null 2>&1 || sv up "$SERVICE_DIR" >/dev/null 2>&1; then
    service_started=1
    break
  fi
  sleep 0.25
done
[ "$service_started" -eq 1 ] || { echo 'Caddy service could not be started.' >&2; exit 1; }

endpoint_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -kfsS --max-time 3 \
    --resolve "${SPAR_HTTPS_HOST}:${SPAR_HTTPS_PORT}:127.0.0.1" \
    "$(spar_https_url)/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    endpoint_ok=1
    break
  fi
  sleep 0.25
done
if [ "$endpoint_ok" -ne 1 ]; then
  echo 'Caddy started but the Spararama HTTPS health endpoint did not verify.' >&2
  tail -n 40 "$SPAR_CADDY_SERVICE_LOG_FILE" >&2 2>/dev/null || true
  exit 1
fi

# Persist the loopback backend only after the proxy has proved it can serve the
# requested hostname/port. A later `spar restart` therefore cannot lock out LAN
# access because of an invalid certificate, Caddyfile, or occupied port.
persist SPAR_HTTPS_ENABLED 1
persist SPAR_HTTPS_HOST "$SPAR_HTTPS_HOST"
persist SPAR_HTTPS_PORT "$SPAR_HTTPS_PORT"
persist SPAR_HTTPS_MODE "$SPAR_HTTPS_MODE"
persist SPAR_TLS_CERT_FILE "$SPAR_TLS_CERT_FILE"
persist SPAR_TLS_KEY_FILE "$SPAR_TLS_KEY_FILE"
persist SPAR_BIND_HOST 127.0.0.1

SETUP_COMPLETE=1
printf 'HTTPS verified at %s\n' "$(spar_https_url)"
printf 'Restart Spararama so its backend becomes loopback-only: spar restart\n'