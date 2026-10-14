#!/usr/bin/env bash
set -euo pipefail

SANDBOX_NAME="tandem-box"
IMAGE_TAG="tandem:latest"
PORT="4820"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

function log() {
  echo -e "\033[1;34m[Tandem Sandbox]\033[0m $*"
}

function error() {
  echo -e "\033[1;31m[Error]\033[0m $*" >&2
}

function check_prerequisites() {
  if ! command -v sbx >/dev/null 2>&1; then
    error "sbx (Docker Sandboxes CLI) is not installed."
    error "Install it via: brew install --cask docker/tap/sbx"
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

  local status
  status=$(sbx ls 2>/dev/null | grep -E "^${SANDBOX_NAME}\s" || true)

  if [ -z "$status" ]; then
    log "Creating Docker Sandboxes microVM (${SANDBOX_NAME})..."
    sbx run --pull never -d --name "${SANDBOX_NAME}" -p "127.0.0.1:${PORT}:${PORT}" -t "${IMAGE_TAG}" shell "${ROOT_DIR}"
  elif echo "$status" | grep -q "stopped"; then
    log "Restarting stopped sandbox (${SANDBOX_NAME})..."
    sbx run --pull never -d --name "${SANDBOX_NAME}"
  fi

  log "Starting Tandem inside microVM sandbox..."
  sbx exec "${SANDBOX_NAME}" /bin/bash -c "
    if ! pgrep -f 'apps/server/src/main.ts' >/dev/null 2>&1; then
      nohup node apps/server/src/main.ts --host 0.0.0.0 --port ${PORT} --no-open > /tmp/tandem.log 2>&1 &
    fi
  "

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
  pair_url=$(sbx exec "${SANDBOX_NAME}" grep -E "http://localhost:[0-9]+/pair#[a-f0-9]+" /tmp/tandem.log | tail -n 1 | awk '{print $NF}' || true)

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

check_prerequisites

case "${1:-start}" in
  start|"")
    start_sandbox
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
    sbx ls
    ;;
  *)
    echo "Usage: $0 {start|stop|rm|rebuild|logs|shell|status}"
    exit 1
    ;;
esac
