#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [ -z "${PREFIX:-}" ] || [[ "$PREFIX" != *com.termux* ]]; then
  echo "This installer is for Termux on Android." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/spararama"
CONFIG_FILE="$CONFIG_DIR/phone.conf"
SHORTCUT_DIR="$HOME/.shortcuts"
COMMAND_PATH="$PREFIX/bin/spar"

printf '\nSpararama phone setup\n'
printf 'Repo: %s\n\n' "$REPO"

# Keep first-time setup self-contained. pkg skips packages that are already current.
echo "Checking Termux tools..."
pkg install -y git nodejs curl procps >/dev/null

PINNED_PNPM="11.21.0"
CURRENT_PNPM="$(pnpm --version 2>/dev/null || true)"
if [ "$CURRENT_PNPM" != "$PINNED_PNPM" ]; then
  echo "Installing pnpm $PINNED_PNPM..."
  npm install -g "pnpm@$PINNED_PNPM"
else
  echo "pnpm $PINNED_PNPM is already installed."
fi

mkdir -p "$CONFIG_DIR" "$SHORTCUT_DIR"
chmod 700 "$SHORTCUT_DIR"

# Remember the actual checkout path rather than assuming ~/Spararama.
{
  printf '# Spararama Termux phone settings.\n'
  printf '# The phone runner defaults to mock mode so it is safe away from the real spa.\n'
  printf 'SPAR_REPO=%q\n' "$REPO"
  printf 'SPAR_BRANCH=%q\n' 'chatgpt-dev'
  printf 'SPAR_ADAPTER=%q\n' 'mock'
  printf 'SPAR_PORT=%q\n' '3000'
} > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

# Install a tiny stable wrapper. It executes a temporary copy of the runner from
# the repo, so future `git pull`s automatically update `spar` without needing to
# rerun this installer. Using a temporary copy also means the runner can safely
# pull a newer version of itself while it is executing.
cat > "$COMMAND_PATH" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -u
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/spararama/phone.conf"
[ -f "$CONFIG_FILE" ] || { echo "Spararama phone config is missing. Re-run scripts/termux/install.sh." >&2; exit 1; }
# shellcheck disable=SC1090
source "$CONFIG_FILE"
RUNNER="$SPAR_REPO/scripts/termux/spar"
[ -f "$RUNNER" ] || { echo "Spararama phone runner is missing: $RUNNER" >&2; exit 1; }
TMP_RUNNER="$(mktemp "${TMPDIR:-$PREFIX/tmp}/spararama-runner.XXXXXX")"
cp "$RUNNER" "$TMP_RUNNER"
bash "$TMP_RUNNER" "$@"
STATUS=$?
rm -f "$TMP_RUNNER"
exit "$STATUS"
EOF
chmod 755 "$COMMAND_PATH"

cp "$SCRIPT_DIR/Spararama.shortcut" "$SHORTCUT_DIR/Spararama"
chmod 700 "$SHORTCUT_DIR/Spararama"

cat <<EOF

Installed.

From now on, type:

  spar

That pulls the latest chatgpt-dev code, updates dependencies only when needed,
restarts the phone server, and opens Spararama in the browser.

Useful extras:
  spar status
  spar stop
  spar log

A Termux home-screen shortcut named "Spararama" has also been installed.
Add a Termux shortcut/widget to the Android home screen and select Spararama.

Full notes: $REPO/docs/termux-phone.md
EOF
