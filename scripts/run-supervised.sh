#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4820}"
LOG_FILE="/tmp/tandem.log"

while true; do
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting Tandem on port ${PORT}..." >> "${LOG_FILE}"
  node apps/server/src/main.ts --host 0.0.0.0 --port "${PORT}" --no-open >> "${LOG_FILE}" 2>&1 || true
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Tandem server process exited. Restarting in 1s..." >> "${LOG_FILE}"
  sleep 1
done
