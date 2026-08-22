#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${PENAUP_DATA_DIR:-/var/lib/penaup/data}"
BACKUP_DIR="${PENAUP_BACKUP_DIR:-/var/backups/penaup}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd -- "${SCRIPT_DIR}/../server" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/${STAMP}"

umask 077
mkdir -p "${TARGET}"

if [[ ! -f "${DATA_DIR}/penaup.db" ]]; then
  echo "database not found: ${DATA_DIR}/penaup.db" >&2
  exit 1
fi

cd "${SERVER_DIR}"
node --input-type=module - "${DATA_DIR}/penaup.db" "${TARGET}/penaup.db" <<'NODE'
import Database from 'better-sqlite3';
const [sourcePath, targetPath] = process.argv.slice(2);
const source = new Database(sourcePath, { readonly: true });
await source.backup(targetPath);
source.close();
NODE

if [[ -d "${DATA_DIR}/media" ]]; then
  tar -C "${DATA_DIR}" -czf "${TARGET}/media.tar.gz" media
fi

find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "backup created: ${TARGET}"
