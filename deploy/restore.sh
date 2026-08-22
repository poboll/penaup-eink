#!/usr/bin/env bash
set -euo pipefail

# Restore one backup created by backup.sh. The target must be explicitly named;
# --force moves an existing target aside instead of deleting it.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVER_DIR="$(cd -- "${SCRIPT_DIR}/../server" && pwd -P)"
SOURCE_DIR="${1:-}"
TARGET_DIR="${2:-}"
FORCE="${PENAUP_RESTORE_FORCE:-0}"

if [[ "${3:-}" == "--force" ]]; then
  FORCE=1
fi

if [[ -z "${SOURCE_DIR}" || -z "${TARGET_DIR}" ]]; then
  echo "usage: $0 BACKUP_DIRECTORY TARGET_DATA_DIRECTORY [--force]" >&2
  exit 2
fi

SOURCE_DIR="$(cd -- "${SOURCE_DIR}" && pwd -P)"
TARGET_PARENT="$(dirname -- "${TARGET_DIR}")"
TARGET_NAME="$(basename -- "${TARGET_DIR}")"
mkdir -p -- "${TARGET_PARENT}"
TARGET_PARENT="$(cd -- "${TARGET_PARENT}" && pwd -P)"
TARGET_DIR="${TARGET_PARENT}/${TARGET_NAME}"

if [[ "${TARGET_DIR}" == "/" || -z "${TARGET_NAME}" || "${SOURCE_DIR}" == "${TARGET_DIR}" ]]; then
  echo "refusing an unsafe restore target" >&2
  exit 2
fi

BACKUP_DB="${SOURCE_DIR}/penaup.db"
if [[ ! -f "${BACKUP_DB}" ]]; then
  echo "backup database not found: ${BACKUP_DB}" >&2
  exit 1
fi
if [[ -e "${TARGET_DIR}" && "${FORCE}" != "1" ]]; then
  echo "target already exists; pass --force to create a rollback copy: ${TARGET_DIR}" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK_DIR="${TARGET_DIR}.before-restore-${STAMP}"
if [[ -e "${ROLLBACK_DIR}" ]]; then
  echo "rollback target already exists: ${ROLLBACK_DIR}" >&2
  exit 1
fi

umask 077
STAGE="$(mktemp -d "${TARGET_PARENT}/.penaup-restore.XXXXXX")"
cleanup() {
  if [[ -n "${STAGE:-}" && -d "${STAGE}" ]]; then
    rm -rf -- "${STAGE}"
  fi
}
trap cleanup EXIT

(
cd -- "${SERVER_DIR}"
node --input-type=module - "${BACKUP_DB}" "${STAGE}/penaup.db" <<'NODE'
import Database from 'better-sqlite3';

const [sourcePath, targetPath] = process.argv.slice(2);
const source = new Database(sourcePath, { readonly: true });
try {
  const integrity = source.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`sqlite_integrity_check_failed: ${integrity}`);
  await source.backup(targetPath);
} finally {
  source.close();
}
NODE
)

if [[ -f "${SOURCE_DIR}/media.tar.gz" ]]; then
  while IFS= read -r entry; do
    case "${entry}" in
      media|media/*) ;;
      *) echo "unsafe media archive entry: ${entry}" >&2; exit 1 ;;
    esac
    case "${entry}" in
      /*|../*|*/../*|*/.. ) echo "unsafe media archive path: ${entry}" >&2; exit 1 ;;
    esac
  done < <(tar -tzf "${SOURCE_DIR}/media.tar.gz")
  tar -xzf "${SOURCE_DIR}/media.tar.gz" -C "${STAGE}"
else
  mkdir -m 700 "${STAGE}/media"
fi

UNSAFE_ENTRY="$(find "${STAGE}/media" -type l -o -type b -o -type c -o -type p -o -type s | head -n 1 || true)"
if [[ -n "${UNSAFE_ENTRY}" ]]; then
  echo "refusing special media entry: ${UNSAFE_ENTRY}" >&2
  exit 1
fi
chmod 600 "${STAGE}/penaup.db"
chmod 700 "${STAGE}" "${STAGE}/media"

if [[ -e "${TARGET_DIR}" ]]; then
  mv -- "${TARGET_DIR}" "${ROLLBACK_DIR}"
fi
mv -- "${STAGE}" "${TARGET_DIR}"
STAGE=""

if [[ -e "${ROLLBACK_DIR}" ]]; then
  echo "restore completed: ${TARGET_DIR}"
  echo "rollback preserved: ${ROLLBACK_DIR}"
else
  echo "restore completed: ${TARGET_DIR}"
fi
