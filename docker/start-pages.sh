#!/bin/sh

set -eu

: "${REFRESH_SECRET:=local}"
: "${RFD_BASE_URL:=https://forums.redflagdeals.com}"
: "${REDIRECTS_URL:=https://raw.githubusercontent.com/davegallant/rfd-redirect-stripper/main/redirects.json}"
: "${WRANGLER_COMPATIBILITY_DATE:=2026-06-22}"
: "${WRANGLER_STATE_DIR:=/var/lib/rfd/state}"
: "${SSL_CERT_FILE:=/etc/ssl/certs/ca-certificates.crt}"
export SSL_CERT_FILE

mkdir -p "${WRANGLER_STATE_DIR}"

exec /app/node_modules/.bin/wrangler pages dev /app/dist \
  --compatibility-date "${WRANGLER_COMPATIBILITY_DATE}" \
  --ip 0.0.0.0 \
  --port 8788 \
  --kv TOPICS_KV \
  --binding "REFRESH_SECRET=${REFRESH_SECRET}" \
  --binding "RFD_BASE_URL=${RFD_BASE_URL}" \
  --binding "REDIRECTS_URL=${REDIRECTS_URL}" \
  --persist-to "${WRANGLER_STATE_DIR}" \
  --show-interactive-dev-session=false
