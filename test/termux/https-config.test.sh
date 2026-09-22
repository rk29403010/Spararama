#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/termux/https-config.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

SPAR_HTTPS_ENABLED=1
SPAR_HTTPS_HOST='spararama.home.arpa'
SPAR_HTTPS_PORT=8443
SPAR_HTTPS_MODE=internal
SPAR_PORT=3000
SPAR_CADDY_LOG_FILE="$TEMP_DIR/caddy.log"
SPAR_TLS_CERT_FILE=''
SPAR_TLS_KEY_FILE=''
spar_https_write_caddyfile "$TEMP_DIR/Caddyfile"
grep -Fq 'auto_https disable_redirects' "$TEMP_DIR/Caddyfile"
grep -Fq 'https://spararama.home.arpa:8443 {' "$TEMP_DIR/Caddyfile"
grep -Fq 'tls internal' "$TEMP_DIR/Caddyfile"
grep -Fq 'reverse_proxy 127.0.0.1:3000 {' "$TEMP_DIR/Caddyfile"

SPAR_HTTPS_MODE=external
SPAR_TLS_CERT_FILE='/secure/cert.pem'
SPAR_TLS_KEY_FILE='/secure/key.pem'
spar_https_write_caddyfile "$TEMP_DIR/external.Caddyfile"
grep -Fq 'tls /secure/cert.pem /secure/key.pem' "$TEMP_DIR/external.Caddyfile"

SPAR_HTTPS_PORT=443
if spar_https_validate >/dev/null 2>&1; then
  echo 'expected privileged HTTPS port validation failure' >&2
  exit 1
fi

echo 'HTTPS Caddy configuration checks passed.'
