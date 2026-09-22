#!/usr/bin/env bash
# Shared, dependency-free HTTPS configuration helpers. This file is sourced by
# the Termux runner and setup commands, and may be checked on a development PC.

spar_https_validate() {
  case "${SPAR_HTTPS_ENABLED:-0}" in 0|1) ;; *) echo 'SPAR_HTTPS_ENABLED must be 0 or 1.' >&2; return 1 ;; esac
  [ "${SPAR_HTTPS_ENABLED:-0}" = 1 ] || return 0
  [ -n "${SPAR_HTTPS_HOST:-}" ] || { echo 'SPAR_HTTPS_HOST is required when HTTPS is enabled.' >&2; return 1; }
  case "${SPAR_HTTPS_PORT:-8443}" in *[!0-9]*|'') echo 'SPAR_HTTPS_PORT must be a numeric non-privileged port.' >&2; return 1 ;; esac
  [ "${SPAR_HTTPS_PORT:-8443}" -ge 1024 ] && [ "${SPAR_HTTPS_PORT:-8443}" -le 65535 ] || { echo 'SPAR_HTTPS_PORT must be between 1024 and 65535.' >&2; return 1; }
  case "${SPAR_HTTPS_MODE:-internal}" in
    internal) ;;
    external)
      [ -n "${SPAR_TLS_CERT_FILE:-}" ] && [ -n "${SPAR_TLS_KEY_FILE:-}" ] || { echo 'External TLS mode requires SPAR_TLS_CERT_FILE and SPAR_TLS_KEY_FILE.' >&2; return 1; }
      ;;
    *) echo 'SPAR_HTTPS_MODE must be internal or external.' >&2; return 1 ;;
  esac
}

spar_https_url() {
  printf 'https://%s:%s\n' "$SPAR_HTTPS_HOST" "$SPAR_HTTPS_PORT"
}

spar_https_write_caddyfile() {
  local target="$1"
  spar_https_validate || return 1
  mkdir -p "$(dirname "$target")"
  {
    printf '{\n'
    printf '  admin off\n'
    # Termux cannot bind the privileged port 80 that Caddy otherwise opens for
    # automatic redirects, and the public Spararama URL deliberately uses 8443.
    printf '  auto_https disable_redirects\n'
    printf '}\n\n'
    printf 'https://%s:%s {\n' "$SPAR_HTTPS_HOST" "$SPAR_HTTPS_PORT"
    printf '  log {\n    output file %s\n  }\n' "$SPAR_CADDY_LOG_FILE"
    if [ "$SPAR_HTTPS_MODE" = 'internal' ]; then
      printf '  tls internal\n'
    else
      printf '  tls %s %s\n' "$SPAR_TLS_CERT_FILE" "$SPAR_TLS_KEY_FILE"
    fi
    printf '  reverse_proxy 127.0.0.1:%s {\n' "$SPAR_PORT"
    printf '    header_up Host {host}\n'
    printf '    header_up X-Real-IP {remote_host}\n'
    printf '    header_up X-Forwarded-For {remote_host}\n'
    printf '    header_up X-Forwarded-Proto {scheme}\n'
    printf '  }\n}\n'
  } > "$target"
}
