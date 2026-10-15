#!/usr/bin/env bash
set -euo pipefail

# Determine repository and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPOSITORY_DIR"

# Ensure essential tools are discoverable in non-login environments
for extra_path in "$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin" "/usr/bin" "/bin"; do
  if [[ -d "$extra_path" && ":$PATH:" != *":$extra_path:"* ]]; then
    export PATH="$extra_path:$PATH"
  fi
done

# State and log directory
STATE_DIR="${TANDEM_HOME:-$HOME/.tandem}"
mkdir -p "$STATE_DIR"
LOG_FILE="${STATE_DIR}/update.log"

# Default configuration flags
DO_DETACH=0
DO_PULL=1
DO_TEST=1
IS_EXEC=0
TIMEOUT=45
PORT=4820

# Parse options
PASSTHROUGH_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --detach)
      DO_DETACH=1
      shift
      ;;
    --no-detach)
      DO_DETACH=0
      shift
      ;;
    --no-pull)
      DO_PULL=0
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
    --no-test)
      DO_TEST=0
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
    --timeout)
      TIMEOUT="$2"
      PASSTHROUGH_ARGS+=("$1" "$2")
      shift 2
      ;;
    --port)
      PORT="$2"
      PASSTHROUGH_ARGS+=("$1" "$2")
      shift 2
      ;;
    --exec)
      IS_EXEC=1
      shift
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

# Auto-detect if running inside Tandem service process tree or cgroup
if [[ "$IS_EXEC" -eq 0 && "$DO_DETACH" -eq 0 ]]; then
  if [[ "${TANDEM_SERVICE:-0}" == "1" ]] || ( [[ -f /proc/self/cgroup ]] && grep -q "tandem\.service" /proc/self/cgroup 2>/dev/null ); then
    DO_DETACH=1
  fi
fi

# If detachment is required, launch decoupled worker and return immediately
if [[ "$DO_DETACH" -eq 1 && "$IS_EXEC" -eq 0 ]]; then
  echo "[Tandem Updater] Detached execution requested or running inside Tandem service."
  echo "[Tandem Updater] Diagnostics will be recorded to: $LOG_FILE"

  # On Linux systemd: prefer systemd-run for complete cgroup isolation
  if command -v systemd-run >/dev/null 2>&1 && systemctl --user is-active --quiet tandem 2>/dev/null; then
    UNIT_NAME="tandem-updater-$(date +%s)"
    echo "[Tandem Updater] Spawning transient systemd unit: $UNIT_NAME"
    systemd-run --user --unit="$UNIT_NAME" --collect \
      /bin/bash "$0" --exec "${PASSTHROUGH_ARGS[@]}" >> "$LOG_FILE" 2>&1
    echo "[Tandem Updater] Update process detached successfully."
    echo "[Tandem Updater] Web client will temporarily disconnect during service restart."
    exit 0
  fi

  # Fallback: nohup background process decoupled from current terminal/session
  echo "[Tandem Updater] Spawning background worker via nohup..."
  nohup /bin/bash "$0" --exec "${PASSTHROUGH_ARGS[@]}" </dev/null >> "$LOG_FILE" 2>&1 &
  WORKER_PID=$!
  echo "[Tandem Updater] Detached background worker started (PID: $WORKER_PID)."
  echo "[Tandem Updater] Web client will temporarily disconnect during service restart."
  exit 0
fi

# --- Worker execution below ---

log() {
  local level="$1"
  shift
  local timestamp
  timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  local msg="[$timestamp] [$level] $*"
  echo "$msg"
  if [[ "$IS_EXEC" -eq 0 ]]; then
    echo "$msg" >> "$LOG_FILE"
  fi
}

restart_service() {
  log "INFO" "Restarting Tandem background service..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local domain="gui/$(id -u)"
    launchctl kickstart -k "$domain/com.tandem.server" 2>&1 || true
  else
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user daemon-reload 2>/dev/null || true
      systemctl --user restart tandem 2>&1 || true
    fi
  fi
}

wait_for_health() {
  local max_seconds="${1:-45}"
  local health_url="http://127.0.0.1:${PORT}/health"
  log "INFO" "Awaiting service health check at $health_url (timeout: ${max_seconds}s)..."
  local deadline=$(( $(date +%s) + max_seconds ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -sf --max-time 2 "$health_url" >/dev/null 2>&1; then
      log "INFO" "Health check passed: service is active."
      return 0
    fi
    sleep 1
  done
  log "WARN" "Health check timed out after ${max_seconds}s."
  return 1
}

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
log "INFO" "Initiating Tandem update sequence. Baseline commit: $PREVIOUS_COMMIT"

rollback() {
  local reason="$1"
  log "ERROR" "Update failed: $reason"
  log "WARN" "Executing automatic rollback to baseline commit: $PREVIOUS_COMMIT"

  if [[ "${TANDEM_NO_ROLLBACK_RESET:-0}" -ne 1 ]]; then
    git reset --hard "$PREVIOUS_COMMIT" || true
    bun install || true
    bun run build || true
    restart_service || true
  else
    log "INFO" "Skipping destructive git reset (TANDEM_NO_ROLLBACK_RESET set)."
  fi

  if wait_for_health "$TIMEOUT"; then
    log "INFO" "Rollback succeeded. Tandem restored to stable baseline: $PREVIOUS_COMMIT."
  else
    log "FATAL" "Rollback was executed, but service did not pass health check! Manual recovery required."
  fi
  exit 1
}

# 1. Pull latest Git commits
if [[ "$DO_PULL" -eq 1 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    log "WARN" "Working tree has uncommitted changes. Stashing before update..."
    git stash save "Auto-stashed by Tandem Updater $(date -u +'%Y-%m-%dT%H:%M:%SZ')" || true
  fi
  log "INFO" "Fetching latest changes from remote Git repository..."
  git pull --ff-only || rollback "git pull failed (network failure or non-fast-forward)"
else
  log "INFO" "Skipping Git pull (--no-pull specified)."
fi

TARGET_COMMIT="$(git rev-parse HEAD)"
log "INFO" "Target commit for update: $TARGET_COMMIT"

# 2. Dependency synchronization
log "INFO" "Synchronizing dependencies (bun install)..."
bun install || rollback "bun install failed"

# 3. Static checks and typechecking
log "INFO" "Running static checks and type validation (bun run check)..."
bun run check || rollback "bun run check failed (linting or typecheck errors)"

# 4. Automated unit tests
if [[ "$DO_TEST" -eq 1 ]]; then
  log "INFO" "Executing test suite (bun run test)..."
  bun run test || rollback "bun run test failed"
else
  log "INFO" "Skipping test suite (--no-test specified)."
fi

# 5. Build application bundles
log "INFO" "Compiling project artifacts (bun run build)..."
bun run build || rollback "bun run build failed"

# 6. Restart background service
restart_service

# 7. Health check watchdog
if ! wait_for_health "$TIMEOUT"; then
  rollback "New service version failed to pass health check within ${TIMEOUT}s"
fi

log "INFO" "Tandem update completed successfully. Service is healthy on commit $TARGET_COMMIT."
exit 0
