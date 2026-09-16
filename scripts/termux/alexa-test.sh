#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO/.env"
PHONE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/spararama/phone.conf"
SPAR_PORT="3000"

if [ -f "$PHONE_CONFIG" ]; then
  # shellcheck disable=SC1090
  source "$PHONE_CONFIG"
fi

say() { printf '\n%s\n' "$1"; }
fail() { printf '\nSpararama Alexa setup: %s\n' "$1" >&2; exit 1; }

read_env_value() {
  local key="$1"
  local line=""
  [ -f "$ENV_FILE" ] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="${line#\"}"
  line="${line%\"}"
  printf '%s' "$line"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp="$ENV_FILE.tmp"
  local escaped="$value"
  escaped="${escaped//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  touch "$ENV_FILE"
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s="%s"\n' "$key" "$escaped" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

restart_spararama() {
  if ! command -v spar >/dev/null 2>&1; then
    fail "the Termux 'spar' command is not installed. Run: bash scripts/termux/install.sh"
  fi
  spar restart
}

setup() {
  local skill_id="${1:-}"
  if [ -z "$skill_id" ]; then
    printf 'Alexa skill ID (amzn1.ask.skill...): '
    IFS= read -r skill_id
  fi
  [[ "$skill_id" == amzn1.ask.skill.* ]] || fail "that does not look like an Alexa skill ID."

  local secret
  secret="$(read_env_value ALEXA_DIRECT_PROXY_SECRET)"
  if [ -z "$secret" ]; then
    secret="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  fi

  set_env_value ALEXA_DIRECT_ENABLED true
  set_env_value ALEXA_DIRECT_PROXY_SECRET "$secret"
  set_env_value ALEXA_SKILL_ID "$skill_id"
  set_env_value SPARARAMA_TIME_ZONE Europe/London

  say "Restarting Spararama with the direct Alexa endpoint enabled..."
  restart_spararama

  cat <<EOF

Direct Alexa backend is enabled on this phone.

Copy these values into the AWS Lambda environment:

ALEXA_SKILL_ID=$skill_id
SPARARAMA_ALEXA_PROXY_SECRET=$secret
SPARARAMA_ALEXA_URL=<your temporary HTTPS URL>/api/alexa/direct
LWA_CLIENT_ID=<your Login with Amazon client ID>

The secret is stored only in the ignored local .env file on this phone.
Next, once Lambda and the Alexa skill exist, run:

  bash scripts/termux/alexa-test.sh tunnel
EOF
}

lambda_env() {
  local enabled skill_id secret
  enabled="$(read_env_value ALEXA_DIRECT_ENABLED)"
  skill_id="$(read_env_value ALEXA_SKILL_ID)"
  secret="$(read_env_value ALEXA_DIRECT_PROXY_SECRET)"
  [ "$enabled" = "true" ] || fail "direct Alexa is not enabled. Run the setup command first."
  [ -n "$skill_id" ] || fail "ALEXA_SKILL_ID is missing."
  [ -n "$secret" ] || fail "ALEXA_DIRECT_PROXY_SECRET is missing."

  cat <<EOF
ALEXA_SKILL_ID=$skill_id
SPARARAMA_ALEXA_PROXY_SECRET=$secret
SPARARAMA_ALEXA_URL=<your temporary HTTPS URL>/api/alexa/direct
LWA_CLIENT_ID=<your Login with Amazon client ID>
EOF
}

status() {
  local enabled skill_id secret
  enabled="$(read_env_value ALEXA_DIRECT_ENABLED)"
  skill_id="$(read_env_value ALEXA_SKILL_ID)"
  secret="$(read_env_value ALEXA_DIRECT_PROXY_SECRET)"
  printf 'Direct Alexa: %s\n' "${enabled:-false}"
  printf 'Skill ID: %s\n' "${skill_id:-not configured}"
  if [ -n "$secret" ]; then
    printf 'Proxy secret: configured\n'
  else
    printf 'Proxy secret: not configured\n'
  fi
}

disable() {
  set_env_value ALEXA_DIRECT_ENABLED false
  say "Disabling the direct Alexa endpoint and restarting Spararama..."
  restart_spararama
  printf '\nDirect Alexa disabled. Voice Monkey settings were not changed.\n'
}

tunnel() {
  local enabled skill_id secret
  enabled="$(read_env_value ALEXA_DIRECT_ENABLED)"
  skill_id="$(read_env_value ALEXA_SKILL_ID)"
  secret="$(read_env_value ALEXA_DIRECT_PROXY_SECRET)"
  [ "$enabled" = "true" ] || fail "direct Alexa is disabled. Run setup first."
  [ -n "$skill_id" ] || fail "ALEXA_SKILL_ID is missing."
  [ -n "$secret" ] || fail "ALEXA_DIRECT_PROXY_SECRET is missing."

  if ! curl -fsS --max-time 2 "http://127.0.0.1:${SPAR_PORT}/api/health" >/dev/null 2>&1; then
    fail "Spararama is not responding on port ${SPAR_PORT}. Run 'spar live' or 'spar restart' first."
  fi

  if ! command -v ssh >/dev/null 2>&1; then
    say "Installing the SSH client needed for the temporary HTTPS tunnel..."
    pkg install -y openssh >/dev/null
  fi

  local proxy_port="${SPAR_ALEXA_TUNNEL_PORT:-3001}"
  local proxy_log="${TMPDIR:-$PREFIX/tmp}/spararama-alexa-proxy.log"
  local proxy_pid=""

  cleanup() {
    if [ -n "$proxy_pid" ] && kill -0 "$proxy_pid" 2>/dev/null; then
      kill "$proxy_pid" 2>/dev/null || true
      wait "$proxy_pid" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM

  SPARARAMA_LOCAL_URL="http://127.0.0.1:${SPAR_PORT}/api/alexa/direct" \
    PORT="$proxy_port" \
    node "$REPO/services/alexa/local-proxy.mjs" >"$proxy_log" 2>&1 &
  proxy_pid=$!

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 1 "http://127.0.0.1:${proxy_port}/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
      cat "$proxy_log" >&2 || true
      fail "the Alexa-only local proxy failed to start."
    fi
    sleep 0.2
  done

  curl -fsS --max-time 1 "http://127.0.0.1:${proxy_port}/health" >/dev/null 2>&1 \
    || fail "the Alexa-only local proxy did not become ready."

  cat <<EOF

Opening a TEMPORARY HTTPS tunnel for Alexa testing.
Only POST /api/alexa/direct is forwarded to Spararama; the app itself is not exposed.

localhost.run will print an https://...localhost.run address below.
Put that address into Lambda as:

SPARARAMA_ALEXA_URL=https://...localhost.run/api/alexa/direct

Keep this command running while testing Alexa. Ctrl+C closes the tunnel.

EOF

  ssh -T \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -R "80:localhost:${proxy_port}" \
    nokey@localhost.run
}

show_help() {
  cat <<'EOF'
Spararama temporary direct-Alexa test helper

  bash scripts/termux/alexa-test.sh setup <skill-id>
      Enable the protected Alexa route, generate/reuse its secret, and restart Spararama.

  bash scripts/termux/alexa-test.sh tunnel
      Open a temporary HTTPS localhost.run tunnel exposing only the Alexa route.

  bash scripts/termux/alexa-test.sh lambda-env
      Reprint the Lambda values (including the proxy secret).

  bash scripts/termux/alexa-test.sh status
      Show local Alexa setup state without printing the secret.

  bash scripts/termux/alexa-test.sh disable
      Disable direct Alexa and restart Spararama. Voice Monkey is untouched.
EOF
}

command="${1:-help}"
case "$command" in
  setup) setup "${2:-}" ;;
  tunnel) tunnel ;;
  lambda-env) lambda_env ;;
  status) status ;;
  disable) disable ;;
  help|-h|--help) show_help ;;
  *) show_help; fail "unknown command: $command" ;;
esac
