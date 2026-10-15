#!/usr/bin/env bash
set -euo pipefail

SANDBOX_NAME="tandem-box"
IMAGE_TAG="tandem:latest"
PORT="4820"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="${TANDEM_WORKSPACE_DIR:-${ROOT_DIR}/workspace}"
DATA_DIR="${TANDEM_DATA_DIR:-${HOME}/.tandem}"

function log() {
  echo -e "\033[1;34m[Tandem Sandbox]\033[0m $*"
}

function error() {
  echo -e "\033[1;31m[Error]\033[0m $*" >&2
}

function check_prerequisites() {
  if ! command -v sbx >/dev/null 2>&1; then
    error "sbx (Docker Sandboxes CLI) is not installed."
    case "$(uname -s)" in
      Darwin)
        error "Install on macOS via: brew tap docker/tap && brew install --cask docker/tap/sbx"
        ;;
      Linux)
        error "Install on Linux via: https://docs.docker.com/ai/sandboxes/"
        ;;
      *)
        error "Install via: https://docs.docker.com/ai/sandboxes/"
        ;;
    esac
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    error "Docker is not installed or not in PATH."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Please start Docker Desktop."
    exit 1
  fi

  if ! sbx diagnose 2>/dev/null | grep -iE "Authentication.*authenticated" >/dev/null 2>&1; then
    log "Docker Sandboxes is not signed in. Initiating login..."
    log "A browser window will open. Please complete the login, and the script will automatically continue."
    sbx login
  fi
}

function ensure_policy() {
  if ! sbx policy ls >/dev/null 2>&1; then
    log "Initializing default balanced network policy for Docker Sandboxes..."
    sbx policy init balanced
  fi
}

function ensure_template() {
  local force="${1:-0}"
  local has_template
  has_template=$(sbx template ls 2>/dev/null | grep -E "tandem\s+latest" || true)

  if [ -z "$has_template" ] || [ "$force" -eq 1 ]; then
    log "Building Docker image ${IMAGE_TAG}..."
    docker build -t "${IMAGE_TAG}" "${ROOT_DIR}"
    log "Loading ${IMAGE_TAG} into Docker Sandboxes microVM template store..."
    local tar_file="/tmp/tandem-build-$$.tar"
    docker save "${IMAGE_TAG}" -o "${tar_file}"
    sbx template load "${tar_file}"
    rm -f "${tar_file}"
    log "Template ${IMAGE_TAG} loaded successfully."
  fi
}

function start_sandbox() {
  ensure_policy
  ensure_template 0

  mkdir -p "${WORKSPACE_DIR}"
  mkdir -p "${DATA_DIR}"

  local status
  status=$(sbx ls 2>/dev/null | grep -E "^${SANDBOX_NAME}\s" || true)

  if [ -z "$status" ]; then
    log "Creating Docker Sandboxes microVM (${SANDBOX_NAME})..."
    sbx run --pull never -d --name "${SANDBOX_NAME}" -p "127.0.0.1:${PORT}:${PORT}" -t "${IMAGE_TAG}" shell "${WORKSPACE_DIR}" "${DATA_DIR}"
  elif echo "$status" | grep -q "stopped"; then
    log "Restarting stopped sandbox (${SANDBOX_NAME})..."
    sbx run --pull never -d --name "${SANDBOX_NAME}"
  fi

  log "Starting Tandem inside microVM sandbox..."
  if ! curl -s "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    sbx exec "${SANDBOX_NAME}" /bin/bash -c "cd /app && TANDEM_HOME=\"${DATA_DIR}\" nohup node apps/server/src/main.ts --host 0.0.0.0 --port ${PORT} --no-open </dev/null >/tmp/tandem.log 2>&1 & disown"
  fi

  log "Waiting for Tandem server to become ready..."
  local ready=0
  for _ in $(seq 1 30); do
    if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [ "$ready" -ne 1 ]; then
    error "Tandem server did not become ready within 15 seconds."
    sbx exec "${SANDBOX_NAME}" cat /tmp/tandem.log || true
    exit 1
  fi

  log "Tandem is running securely inside Docker Sandboxes microVM!"
  local pair_url
  pair_url=$(sbx exec "${SANDBOX_NAME}" grep -E "http://[0-9.]*:[0-9]+/pair#[a-f0-9]+" /tmp/tandem.log | tail -n 1 | awk '{print $NF}' | sed 's/0.0.0.0/localhost/' || true)

  if [ -n "$pair_url" ]; then
    echo ""
    echo -e "\033[1;32mPairing URL:\033[0m ${pair_url}"
    echo ""
    if [ "$(uname)" = "Darwin" ]; then
      log "Opening browser..."
      open "${pair_url}" || true
    fi
  else
    echo -e "\033[1;32mWeb Interface:\033[0m http://localhost:${PORT}"
  fi
}

function restart_sandbox() {
  log "Restarting Tandem inside sandbox ${SANDBOX_NAME}..."
  sbx exec "${SANDBOX_NAME}" /bin/bash -c "for pid in \$(ls /proc 2>/dev/null | grep '^[0-9]'); do if grep -q 'main.ts' /proc/\$pid/cmdline 2>/dev/null; then kill -TERM \$pid 2>/dev/null || true; fi; done" 2>/dev/null || true
  
  local stopped=0
  for _ in $(seq 1 20); do
    if ! curl -s "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      stopped=1
      break
    fi
    sleep 0.5
  done

  if [ "$stopped" -ne 1 ]; then
    log "Graceful shutdown timed out. Forcing termination..."
    sbx exec "${SANDBOX_NAME}" /bin/bash -c "for pid in \$(ls /proc 2>/dev/null | grep '^[0-9]'); do if grep -q 'main.ts' /proc/\$pid/cmdline 2>/dev/null; then kill -9 \$pid 2>/dev/null || true; fi; done" 2>/dev/null || true
  fi

  start_sandbox
}

function update_sandbox() {
  log "Initiating Tandem sandbox update sequence..."
  
  if [ -n "$(git -C "${ROOT_DIR}" status --porcelain)" ]; then
    error "Working tree has uncommitted changes. Stash or commit before updating."
    exit 1
  fi

  local current_branch
  current_branch=$(git -C "${ROOT_DIR}" symbolic-ref --short HEAD 2>/dev/null || true)
  local prev_commit
  prev_commit=$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || echo "unknown")
  log "Current branch: ${current_branch:-detached}, commit: ${prev_commit}"

  log "Pulling latest changes from remote Git repository..."
  if ! git -C "${ROOT_DIR}" pull --ff-only; then
    error "Git fast-forward pull failed. Aborting update to avoid merge conflicts."
    exit 1
  fi

  local next_commit
  next_commit=$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || echo "unknown")
  if [ "${prev_commit}" = "${next_commit}" ]; then
    log "Already up to date on commit ${next_commit}."
    restart_sandbox
    return 0
  fi

  log "Running pre-build checks and tests..."
  if ! (cd "${ROOT_DIR}" && bun run check && bun run test); then
    error "Checks or tests failed on target commit ${next_commit}. Aborting update."
    if [ -n "${current_branch}" ]; then
      git -C "${ROOT_DIR}" reset --hard "${prev_commit}"
    else
      git -C "${ROOT_DIR}" checkout "${prev_commit}"
    fi
    exit 1
  fi

  log "Updated to ${next_commit}. Rebuilding template and recreating sandbox..."
  ensure_template 1
  stop_sandbox || true
  remove_sandbox || true

  if ! start_sandbox; then
    error "Health check failed after update. Rolling back to ${prev_commit}..."
    if [ -n "${current_branch}" ]; then
      git -C "${ROOT_DIR}" reset --hard "${prev_commit}"
    else
      git -C "${ROOT_DIR}" checkout "${prev_commit}"
    fi
    ensure_template 1
    start_sandbox
    if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' >/dev/null 2>&1; then
      log "Rollback successful. Restored stable service on commit ${prev_commit}."
    else
      error "Rollback failed. Service did not become healthy."
    fi
    exit 1
  fi

  log "Update completed successfully on commit ${next_commit}."
}

function stop_sandbox() {
  log "Stopping sandbox ${SANDBOX_NAME}..."
  sbx stop "${SANDBOX_NAME}" || true
  log "Sandbox stopped."
}

function remove_sandbox() {
  log "Removing sandbox ${SANDBOX_NAME}..."
  sbx rm --force "${SANDBOX_NAME}" || true
  log "Sandbox removed."
}

function logs_sandbox() {
  sbx exec "${SANDBOX_NAME}" cat /tmp/tandem.log
}

function shell_sandbox() {
  log "Attaching interactive bash shell to ${SANDBOX_NAME}..."
  exec sbx exec -it "${SANDBOX_NAME}" /bin/bash
}

function status_sandbox() {
  sbx ls
  echo ""
  if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' >/dev/null 2>&1; then
    echo -e "\033[1;32m[Health Probe]\033[0m Tandem server is active and healthy on http://127.0.0.1:${PORT}"
  else
    echo -e "\033[1;33m[Health Probe]\033[0m Tandem server is not responding on http://127.0.0.1:${PORT}"
  fi
}

check_prerequisites

case "${1:-start}" in
  start|"")
    start_sandbox
    ;;
  restart|reload)
    restart_sandbox
    ;;
  update)
    update_sandbox
    ;;
  stop)
    stop_sandbox
    ;;
  rm|remove)
    remove_sandbox
    ;;
  rebuild)
    ensure_template 1
    stop_sandbox || true
    remove_sandbox || true
    start_sandbox
    ;;
  logs)
    logs_sandbox
    ;;
  shell)
    shell_sandbox
    ;;
  status)
    status_sandbox
    ;;
  *)
    echo "Usage: $0 {start|restart|reload|update|stop|rm|rebuild|logs|shell|status}"
    exit 1
    ;;
esac
