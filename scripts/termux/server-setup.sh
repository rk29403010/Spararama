#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [ -z "${PREFIX:-}" ] || [[ "$PREFIX" != *com.termux* ]]; then
  echo "This setup script must be run inside Termux on Android." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/spararama-phone"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/10-spararama"
SSH_DIR="$HOME/.ssh"
HOST_ID=""
START_LIVE=0

usage() {
  cat <<'EOF'
Usage: bash scripts/termux/server-setup.sh [--host-id NAME] [--live]

Sets up this Android/Termux installation as an unattended Spararama host:
  - installs the normal Spararama Termux runner
  - installs and enables OpenSSH via termux-services
  - prepares ~/.ssh for key-based access
  - installs a boot script for sshd + Spararama
  - requests a Termux wake lock

Options:
  --host-id NAME   Set TELEMETRY_HOST_ID in .env when .env exists.
                   Example: --host-id spararama-a17
  --live           Switch to the live CleverSpa adapter after setup.
                   Use only while the phone is on the spa's home LAN.
  -h, --help       Show this help.

This script cannot change Samsung/Android battery settings or reserve a router IP;
those manual steps are documented in docs/old-phone-server.md.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host-id)
      [ "$#" -ge 2 ] || { echo "--host-id requires a value" >&2; exit 2; }
      HOST_ID="$2"
      shift 2
      ;;
    --live)
      START_LIVE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

printf '\nSpararama old-phone server setup\n'
printf 'Repo: %s\n\n' "$REPO"

echo "Installing Termux server packages..."
pkg install -y openssh termux-services >/dev/null

# Install/update the supported Spararama phone runner and its pinned dependencies.
bash "$SCRIPT_DIR/install.sh"

mkdir -p "$STATE_DIR" "$BOOT_DIR" "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"

# If a copied laptop .env exists, make the two machine-specific values useful on
# Android without touching any secret values.
set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp="$file.tmp"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    grep -v "^${key}=" "$file" > "$tmp" || true
    printf '%s="%s"\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
  else
    printf '\n%s="%s"\n' "$key" "$value" >> "$file"
  fi
}

if [ -f "$REPO/.env" ]; then
  if [ -n "$HOST_ID" ]; then
    set_env_value "$REPO/.env" "TELEMETRY_HOST_ID" "$HOST_ID"
  fi
  if [ -f "$HOME/.spararama/credentials/firebase-admin.json" ]; then
    set_env_value "$REPO/.env" "GOOGLE_APPLICATION_CREDENTIALS" "$HOME/.spararama/credentials/firebase-admin.json"
  fi
  chmod 600 "$REPO/.env"
fi

# Start the runit service supervisor in this shell and enable sshd for subsequent
# service-manager starts. The same service manager is started from the boot script.
if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
  # shellcheck disable=SC1090
  source "$PREFIX/etc/profile.d/start-services.sh"
fi
if command -v sv-enable >/dev/null 2>&1; then
  sv-enable sshd >/dev/null 2>&1 || true
fi
if command -v sv >/dev/null 2>&1; then
  sv up sshd >/dev/null 2>&1 || true
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

cat > "$BOOT_SCRIPT" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -u

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/spararama-phone"
LOG="$STATE_DIR/boot.log"
mkdir -p "$STATE_DIR"
exec >>"$LOG" 2>&1

echo
echo "========================================"
echo "Boot startup: $(date)"
echo "========================================"

# Keep the CPU available while the phone is acting as a home server.
termux-wake-lock >/dev/null 2>&1 || true

# Start termux-services; sshd is enabled by server-setup.sh.
if [ -f "$PREFIX/etc/profile.d/start-services.sh" ]; then
  # shellcheck disable=SC1090
  source "$PREFIX/etc/profile.d/start-services.sh" || true
fi
sv up sshd >/dev/null 2>&1 || true

# Android can report boot complete before Wi-Fi has fully re-associated. A short
# fixed delay is more portable than querying interfaces, which newer Android
# builds may block from Termux with a netlink permission error.
echo "Waiting 15 seconds for Android/Wi-Fi..."
sleep 15

echo "Starting Spararama..."
"$PREFIX/bin/spar" start || echo "WARNING: spar start returned a failure; inspect server/adapter logs."

echo
echo "Final status:"
"$PREFIX/bin/spar" status || true

echo "Boot startup complete: $(date)"
EOF
chmod 700 "$BOOT_SCRIPT"

if [ "$START_LIVE" -eq 1 ]; then
  echo
  echo "Switching this host to live CleverSpa mode..."
  "$PREFIX/bin/spar" live
else
  echo
  echo "Starting Spararama in its currently configured mode..."
  "$PREFIX/bin/spar" start
fi

USER_NAME="$(whoami 2>/dev/null || printf 'termux-user')"

cat <<EOF

Server setup complete.

SSH service status:
  sv status sshd

Termux username:
  $USER_NAME

SSH port:
  8022

Boot script:
  $BOOT_SCRIPT

Boot log:
  $STATE_DIR/boot.log

Next manual steps:
  1. In Android/Samsung settings, set Termux battery use to Unrestricted and
     exempt it from sleeping/deep-sleep controls.
  2. Reserve the phone's Wi-Fi address in the router (DHCP reservation).
  3. Add a laptop SSH public key to:
       $SSH_DIR/authorized_keys
  4. If this is the live home server and --live was not used, run:
       spar live
  5. If Firebase telemetry is configured, verify with:
       pnpm firebase:diagnose

Full guide:
  $REPO/docs/old-phone-server.md
EOF
