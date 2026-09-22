#!/data/data/com.termux/files/usr/bin/bash
set -u

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/spararama-phone"
BOOT_SCRIPT="$HOME/.termux/boot/10-spararama"
BOOT_LOG="$STATE_DIR/boot.log"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/spararama/phone.conf"
SPAR_PORT=3000
SPAR_HTTPS_ENABLED=0
SPAR_HTTPS_HOST=''
SPAR_HTTPS_PORT=8443
SPAR_HTTPS_MODE=internal
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi
URL="http://127.0.0.1:${SPAR_PORT}"
CADDY_SERVICE_DIR="$PREFIX/var/service/spararama-caddy"

echo "Spararama old-phone server check"
echo "================================"
echo

printf 'Termux user: %s\n' "$(whoami 2>/dev/null || printf '?')"
printf 'Termux version: %s\n' "${TERMUX_VERSION:-unknown}"
printf 'Android model: %s\n' "$(getprop ro.product.model 2>/dev/null || printf 'unknown')"
printf 'Boot script: %s\n' "$([ -x "$BOOT_SCRIPT" ] && printf 'installed' || printf 'missing')"
echo

if command -v sv >/dev/null 2>&1; then
  echo "SSH service:"
  sv status sshd 2>&1 || true
else
  echo "SSH service: termux-services not installed"
fi

echo
if command -v spar >/dev/null 2>&1; then
  echo "Spararama status:"
  spar status 2>&1 || true
else
  echo "Spararama status: spar command not installed"
fi

echo
if curl -fsS --max-time 3 "$URL/api/health" >/dev/null 2>&1; then
  echo "Local HTTP health: OK ($URL/api/health)"
else
  echo "Local HTTP health: FAILED ($URL/api/health)"
fi

if curl -fsS --max-time 3 "$URL/api/telemetry/status" >/dev/null 2>&1; then
  echo "Telemetry API: OK"
else
  echo "Telemetry API: unavailable"
fi

echo
if [ "$SPAR_HTTPS_ENABLED" = "1" ]; then
  HTTPS_URL="https://${SPAR_HTTPS_HOST}:${SPAR_HTTPS_PORT}"
  printf 'HTTPS: enabled (%s CA)\n' "$SPAR_HTTPS_MODE"
  printf 'HTTPS URL: %s\n' "$HTTPS_URL"
  if command -v sv >/dev/null 2>&1; then
    echo 'Caddy service:'
    sv status "$CADDY_SERVICE_DIR" 2>&1 || true
  else
    echo 'Caddy service: termux-services not installed'
  fi
  if curl -kfsS --max-time 3 --resolve "${SPAR_HTTPS_HOST}:${SPAR_HTTPS_PORT}:127.0.0.1" "$HTTPS_URL/api/health" >/dev/null 2>&1; then
    echo 'HTTPS proxy endpoint: OK (local transport check)'
  else
    echo 'HTTPS proxy endpoint: FAILED (backend down, Caddy down, or TLS configuration invalid)'
  fi
  if [ "$SPAR_HTTPS_MODE" = external ] && command -v openssl >/dev/null 2>&1; then
    if curl -fsS --max-time 3 --resolve "${SPAR_HTTPS_HOST}:${SPAR_HTTPS_PORT}:127.0.0.1" "$HTTPS_URL/api/health" >/dev/null 2>&1; then
      echo 'Certificate trust: OK'
    else
      echo 'Certificate trust: FAILED'
    fi
    expiry="$(printf '' | openssl s_client -connect "127.0.0.1:${SPAR_HTTPS_PORT}" -servername "$SPAR_HTTPS_HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || true)"
    [ -n "$expiry" ] && printf 'Certificate expiry: %s\n' "$expiry" || echo 'Certificate expiry: unavailable'
  elif [ "$SPAR_HTTPS_MODE" = internal ]; then
    echo 'Certificate trust: install Caddy internal CA on each client; this mode is not suitable for Google web sign-in.'
  fi
else
  echo 'HTTPS: disabled (HTTP-only deployment)'
fi

echo
if [ -f "$BOOT_LOG" ]; then
  echo "Last boot log lines:"
  tail -n 20 "$BOOT_LOG"
else
  echo "Boot log: none yet"
fi

echo
cat <<'EOF'
Network note:
  Newer Android builds may reject `ip addr`/netlink queries from Termux with
  "cannot bind netlink socket: permission denied". Check the phone's Wi-Fi
  details in Android Settings for its LAN IP and gateway instead.

For LAN access, the phone and client device must be on the same bridged LAN.
If several access points share one SSID, they must not create separate NAT/DHCP
networks and client/AP isolation must be disabled.

HTTPS note:
  A local proxy check bypasses DNS and certificate validation to isolate Caddy and
  the backend. If a client still fails, check that its configured hostname resolves
  to this phone on the current LAN and that it trusts the selected certificate CA.
  Google sign-in additionally requires its exact HTTPS origin and Firebase
  authorized domain to be configured; see docs/old-phone-server.md.
EOF
