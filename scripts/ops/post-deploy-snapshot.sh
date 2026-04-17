#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-soonadmin@192.168.1.210}"
REMOTE_ROOT="${SOON_REMOTE_ROOT:-/home/soonadmin/Soon}"
OUT_DIR="${OUT_DIR:-ops/reports/deploy}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="${OUT_DIR}/soon-post-deploy-backup-${STAMP}.tgz"
META_PATH="${OUT_DIR}/soon-post-deploy-backup-${STAMP}.meta.json"

mkdir -p "${OUT_DIR}"

echo "[Soon/ops] creating post-deploy backup from ${TARGET_HOST}"

ssh "${TARGET_HOST}" "set -euo pipefail; \
  sudo tar --ignore-failed-read -czf - \
    ${REMOTE_ROOT}/.env.local \
    /etc/systemd/system/soon-api.service \
    /etc/cloudflared/config.yml \
    /etc/cloudflared/*.json \
    2>/dev/null" > "${ARCHIVE_PATH}"

REMOTE_META="$(ssh "${TARGET_HOST}" "set -euo pipefail; cd '${REMOTE_ROOT}'; \
  SHA=\$(git rev-parse HEAD); \
  BRANCH=\$(git rev-parse --abbrev-ref HEAD); \
  API=\$(systemctl is-active soon-api || true); \
  TUNNEL=\$(systemctl is-active cloudflared || true); \
  printf '%s|%s|%s|%s\n' \"\$SHA\" \"\$BRANCH\" \"\$API\" \"\$TUNNEL\"")"

IFS='|' read -r SHA BRANCH API TUNNEL <<<"${REMOTE_META}"
CAPTURED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "${META_PATH}" <<JSON
{"remote":"${TARGET_HOST}","capturedAt":"${CAPTURED_AT}","sha":"${SHA}","branch":"${BRANCH}","services":{"soonApi":"${API}","cloudflared":"${TUNNEL}"}}
JSON

echo "[Soon/ops] backup archive: ${ARCHIVE_PATH}"
echo "[Soon/ops] backup meta:    ${META_PATH}"
