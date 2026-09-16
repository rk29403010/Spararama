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
  persist SPAR_BIND_HOST 0.0.0.0
  if command -v sv >/dev/null 2>&1; then sv down spararama-caddy >/dev/null 2>&1 || true; fi
  rm -rf "$SERVICE_DIR"
  echo 'HTTPS disabled. Spararama will use the existing LAN HTTP binding after: spar restart'
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
# shellcheck disable=SC1091
source "$SCRIPT_DIR/https-config.sh"
spar_https_validate

command -v caddy >/dev/null 2>&1 || { echo 'Caddy is not installed. Run: pkg install caddy termux-services' >&2; exit 1; }
mkdir -p "$STATE_DIR" "$SERVICE_DIR"
spar_https_write_caddyfile "$CADDYFILE"
chmod 600 "$CADDYFILE"
if [ "$SPAR_HTTPS_MODE" = external ]; then chmod 600 "$SPAR_TLS_KEY_FILE"; fi

cat > "$SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec caddy run --config '$CADDYFILE' --adapter caddyfile
EOF
chmod 700 "$SERVICE_DIR/run"

persist SPAR_HTTPS_ENABLED 1
persist SPAR_HTTPS_HOST "$SPAR_HTTPS_HOST"
persist SPAR_HTTPS_PORT "$SPAR_HTTPS_PORT"
persist SPAR_HTTPS_MODE "$SPAR_HTTPS_MODE"
persist SPAR_TLS_CERT_FILE "$SPAR_TLS_CERT_FILE"
persist SPAR_TLS_KEY_FILE "$SPAR_TLS_KEY_FILE"
persist SPAR_BIND_HOST 127.0.0.1

if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
  # shellcheck disable=SC1090
  source "$PREFIX/etc/profile.d/start-services.sh"
fi
sv up spararama-caddy >/dev/null 2>&1 || true
printf 'HTTPS configured at %s\n' "$(spar_https_url)"
printf 'Restart Spararama so its backend becomes loopback-only: spar restart\n'

