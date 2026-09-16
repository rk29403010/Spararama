#!/data/data/com.termux/files/usr/bin/bash
set -u

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/spararama-phone"
BOOT_SCRIPT="$HOME/.termux/boot/10-spararama"
BOOT_LOG="$STATE_DIR/boot.log"
URL="http://127.0.0.1:3000"

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
EOF
