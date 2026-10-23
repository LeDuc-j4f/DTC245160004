#!/usr/bin/env bash
# scripts/gen-certs.sh - generate self-signed TLS cert for the reverse proxy
# Usage: bash scripts/gen-certs.sh [domain]
set -euo pipefail
DOMAIN="${1:-localhost}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/nginx/certs"
mkdir -p "$DIR"

if [ -f "$DIR/server.crt" ] && [ -f "$DIR/server.key" ]; then
    echo "[gen-certs] Existing certs found at $DIR, skipping (delete to regenerate)."
    exit 0
fi

openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "$DIR/server.key" \
    -out    "$DIR/server.crt" \
    -subj   "/C=VN/ST=HCM/L=HCM/O=HRM-Dev/OU=HRM/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN},IP:127.0.0.1"
echo "[gen-certs] Generated $DIR/server.crt + server.key for ${DOMAIN}"
