#!/usr/bin/env bash
# scripts/backup_db.sh - dump the running HRM database to ./backups/
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
OUT="$(cd "$(dirname "$0")/.." && pwd)/backups/hrm_${TS}.sql.gz"
mkdir -p "$(dirname "$OUT")"
echo "[backup] writing $OUT"
docker exec hrm_db pg_dump -U "${POSTGRES_USER:-hrm_admin}" -d "${POSTGRES_DB:-hrm}" | gzip > "$OUT"
echo "[backup] done"
