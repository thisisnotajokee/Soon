#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-soonadmin@192.168.1.210}"
REMOTE_ROOT="${SOON_REMOTE_ROOT:-/home/soonadmin/Soon}"
ROLLBACK_REF="${1:-}"

if [[ -z "${ROLLBACK_REF}" ]]; then
  echo "Usage: $0 <git-ref> [--yes]"
  echo "Example: $0 dbb6956 --yes"
  exit 2
fi

CONFIRM="${2:-}"
if [[ "${CONFIRM}" != "--yes" ]]; then
  echo "[Soon/ops] rollback is potentially disruptive."
  echo "[Soon/ops] rerun with --yes to continue: $0 ${ROLLBACK_REF} --yes"
  exit 3
fi

echo "[Soon/ops] rolling back ${TARGET_HOST} to ref ${ROLLBACK_REF}"

ssh "${TARGET_HOST}" "set -euo pipefail; \
  cd '${REMOTE_ROOT}'; \
  git fetch origin; \
  git checkout '${ROLLBACK_REF}'; \
  npm ci; \
  npm run -s db:migrate; \
  sudo systemctl restart soon-api; \
  sleep 2; \
  curl -fsS http://127.0.0.1:3100/health >/dev/null"

echo "[Soon/ops] rollback done and health check passed"
