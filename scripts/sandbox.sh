#!/usr/bin/env bash
set -euo pipefail

SANDBOX_NAME="tandem-box"
IMAGE_TAG="tandem:latest"
PORT="${PORT:-4820}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="${TANDEM_WORKSPACE_DIR:-${ROOT_DIR}/workspace}"
DATA_DIR="${TANDEM_DATA_DIR:-${HOME}/.tandem}"
PROMPTS_DIR="${PI_PROMPTS_DIR:-${HOME}/.pi/agent/prompts}"

export PORT
export TANDEM_WORKSPACE_DIR="${WORKSPACE_DIR}"
export PI_PROMPTS_DIR="${PROMPTS_DIR}"

function log() {
  echo -e "\033[1;34m[Tandem Sandbox]\033[0m $*"
}

function warn() {
  echo -e "\033[1;33m[Warning]\033[0m $*" >&2
}

function error() {
  echo -e "\033[1;31m[Error]\033[0m $*" >&2
}

function usage() {
  echo "Usage: $0 {start|restart|reload|update|stop|rm|rebuild|logs|shell|status}"
  echo "       $0 rebuild [--no-cache]"
}

function detect_runtime() {
  local preference="${TANDEM_RUNTIME:-auto}"

  case "${preference}" in
    sbx|microvm|sandbox)
      RUNTIME="sbx"
      return 0
      ;;
    docker|compose|container)
      RUNTIME="docker"
      return 0
      ;;
    auto)
      ;;
    *)
      error "Unknown TANDEM_RUNTIME='${preference}'. Valid choices: 'auto', 'sbx', 'docker'."
      exit 1
      ;;
  esac

  # If a Docker Compose tandem container already exists, preserve Docker Compose runtime
  if (cd "${ROOT_DIR}" && docker compose ps -a -q tandem 2>/dev/null | grep -q .); then
    RUNTIME="docker"
    return 0
  fi

  # If an sbx microVM already exists, preserve sbx runtime
  if command -v sbx >/dev/null 2>&1 && sbx ls 2>/dev/null | grep -E "^${SANDBOX_NAME}\s" >/dev/null 2>&1; then
    RUNTIME="sbx"
    return 0
  fi

  # In auto mode, check if Docker Sandboxes (sbx) is installed and available
  if command -v sbx >/dev/null 2>&1; then
    RUNTIME="sbx"
    return 0
  fi

  # Auto-fallback to standard Docker container runtime (e.g. for Hackintosh or environments without sbx)
  RUNTIME="docker"
}

function check_prerequisites() {
  if ! command -v docker >/dev/null 2>&1; then
    error "Docker is not installed or not in PATH."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Please start Docker Desktop or the Docker service."
    exit 1
  fi

  if [ "${RUNTIME}" = "sbx" ]; then
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
      error "Alternatively, you can run in standard Docker container mode:"
      error "  export TANDEM_RUNTIME=docker && bun run sandbox"
      exit 1
    fi

    if ! sbx diagnose 2>/dev/null | grep -iE "Authentication.*authenticated" >/dev/null 2>&1; then
      log "Docker Sandboxes is not signed in. Initiating login..."
      log "A browser window will open. Please complete the login, and the script will automatically continue."
      sbx login
    fi
  elif [ "${RUNTIME}" = "docker" ]; then
    if ! docker compose version >/dev/null 2>&1; then
      error "Docker Compose (v2) is required but not found in your Docker installation."
      exit 1
    fi
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
    local build_args=(-t "${IMAGE_TAG}")
    if [ "${REBUILD_NO_CACHE}" -eq 1 ]; then
      build_args+=(--no-cache)
    fi
    docker build "${build_args[@]}" "${ROOT_DIR}"
    log "Loading ${IMAGE_TAG} into Docker Sandboxes microVM template store..."
    local tar_file="/tmp/tandem-build-$$.tar"
    docker save "${IMAGE_TAG}" -o "${tar_file}"
    sbx template load "${tar_file}"
    rm -f "${tar_file}"
    log "Template ${IMAGE_TAG} loaded successfully."
  fi
}

function wait_for_ready() {
  log "Waiting for Tandem server to become ready on http://127.0.0.1:${PORT}..."
  local ready=0
  for _ in $(seq 1 40); do
    if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [ "$ready" -ne 1 ]; then
    error "Tandem server did not become ready within 20 seconds."
    if [ "${RUNTIME}" = "sbx" ]; then
      sbx exec "${SANDBOX_NAME}" cat /tmp/tandem.log || true
    else
      (cd "${ROOT_DIR}" && docker compose logs --tail 50 tandem) || true
    fi
    return 1
  fi
  return 0
}

function display_and_open_pairing() {
  local pair_url=""

  if [ "${RUNTIME}" = "sbx" ]; then
    log "Tandem is running securely inside Docker Sandboxes microVM!"
    pair_url=$(sbx exec "${SANDBOX_NAME}" grep -oE "https?://[^[:space:]]+/pair#[a-f0-9]+" /tmp/tandem.log 2>/dev/null | tail -n 1 | sed 's/0.0.0.0/localhost/' || true)
    if [ -z "$pair_url" ]; then
      pair_url=$(sbx exec "${SANDBOX_NAME}" bun run service pair 2>/dev/null | grep -oE "https?://[^[:space:]]+/pair#[a-f0-9]+" | tail -n 1 | sed 's/0.0.0.0/localhost/' || true)
    fi
  else
    log "Tandem is running securely inside standard Docker container!"
    pair_url=$(cd "${ROOT_DIR}" && docker compose logs tandem 2>&1 | grep -oE "https?://[^[:space:]]+/pair#[a-f0-9]+" | tail -n 1 | sed 's/0.0.0.0/localhost/' || true)
    if [ -z "$pair_url" ]; then
      pair_url=$(cd "${ROOT_DIR}" && docker compose exec tandem bun run service pair 2>/dev/null | grep -oE "https?://[^[:space:]]+/pair#[a-f0-9]+" | tail -n 1 | sed 's/0.0.0.0/localhost/' || true)
    fi
  fi

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

function ensure_host_configs() {
  mkdir -p "${WORKSPACE_DIR}"
  mkdir -p "${PROMPTS_DIR}"
}

function start_sandbox() {
  ensure_host_configs

  if [ "${RUNTIME}" = "sbx" ]; then
    log "Runtime: Docker Sandboxes (microVM hardware isolation)"
    ensure_policy
    ensure_template 0
    mkdir -p "${DATA_DIR}"

    local status
    status=$(sbx ls 2>/dev/null | grep -E "^${SANDBOX_NAME}\s" || true)

    if [ -z "$status" ]; then
      log "Creating Docker Sandboxes microVM (${SANDBOX_NAME})..."
      if ! sbx run --pull never -d --name "${SANDBOX_NAME}" -p "127.0.0.1:${PORT}:${PORT}" -t "${IMAGE_TAG}" shell "${WORKSPACE_DIR}" "${DATA_DIR}" "${PROMPTS_DIR}"; then
        if [ "${TANDEM_RUNTIME:-auto}" = "auto" ]; then
          warn "Docker Sandboxes microVM failed to start on this machine (virtualization might not be supported)."
          warn "Automatically falling back to standard Docker container runtime..."
          RUNTIME="docker"
          start_sandbox
          return
        else
          error "Failed to start Docker Sandboxes microVM."
          exit 1
        fi
      fi
    elif echo "$status" | grep -q "stopped"; then
      log "Restarting stopped sandbox (${SANDBOX_NAME})..."
      sbx run --pull never -d --name "${SANDBOX_NAME}"
    fi

    log "Starting Tandem inside microVM sandbox..."
    if ! curl -s "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      sbx exec "${SANDBOX_NAME}" /bin/bash -c "cd /app && TANDEM_HOME=\"${DATA_DIR}\" PI_CODING_AGENT_DIR=\"$(dirname "${PROMPTS_DIR}")\" nohup node apps/server/src/main.ts --host 0.0.0.0 --port ${PORT} --no-open </dev/null >/tmp/tandem.log 2>&1 & disown"
    fi
  else
    log "Runtime: Docker Compose (standard container isolation)"
    local is_running=0
    if (cd "${ROOT_DIR}" && docker compose ps --status running -q tandem 2>/dev/null | grep -q .); then
      is_running=1
    fi

    if [ "$is_running" -eq 1 ] && curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' >/dev/null 2>&1; then
      log "Tandem is already running and healthy in Docker Compose."
    else
      local has_image
      has_image=$(docker image inspect "${IMAGE_TAG}" 2>/dev/null || true)
      if [ -z "$has_image" ]; then
        log "Building and starting Tandem container via Docker Compose..."
        (cd "${ROOT_DIR}" && docker compose up -d --build)
      else
        log "Starting Tandem container via Docker Compose..."
        (cd "${ROOT_DIR}" && docker compose up -d)
      fi
    fi
  fi

  wait_for_ready
  display_and_open_pairing
}

function restart_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
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
  else
    log "Restarting Tandem container via Docker Compose..."
    (cd "${ROOT_DIR}" && docker compose restart tandem)
    wait_for_ready
    display_and_open_pairing
  fi
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

  log "Updated to ${next_commit}. Rebuilding image and restarting sandbox..."
  if [ "${RUNTIME}" = "sbx" ]; then
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
  else
    (cd "${ROOT_DIR}" && docker compose build)
    (cd "${ROOT_DIR}" && docker compose up -d --force-recreate)
    if ! wait_for_ready; then
      error "Health check failed after update. Rolling back to ${prev_commit}..."
      if [ -n "${current_branch}" ]; then
        git -C "${ROOT_DIR}" reset --hard "${prev_commit}"
      else
        git -C "${ROOT_DIR}" checkout "${prev_commit}"
      fi
      (cd "${ROOT_DIR}" && docker compose build)
      (cd "${ROOT_DIR}" && docker compose up -d --force-recreate)
      if wait_for_ready; then
        log "Rollback successful. Restored stable service on commit ${prev_commit}."
      else
        error "Rollback failed. Service did not become healthy."
      fi
      exit 1
    fi
    display_and_open_pairing
  fi

  log "Update completed successfully on commit ${next_commit}."
}

function stop_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
    log "Stopping sandbox ${SANDBOX_NAME}..."
    sbx stop "${SANDBOX_NAME}" || true
    log "Sandbox stopped."
  else
    log "Stopping Tandem container via Docker Compose..."
    (cd "${ROOT_DIR}" && docker compose stop)
    log "Container stopped."
  fi
}

function remove_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
    log "Removing sandbox ${SANDBOX_NAME}..."
    sbx rm --force "${SANDBOX_NAME}" || true
    log "Sandbox removed."
  else
    log "Removing Tandem container via Docker Compose..."
    (cd "${ROOT_DIR}" && docker compose down)
    log "Container removed."
  fi
}

function rebuild_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
    ensure_template 1
    stop_sandbox || true
    remove_sandbox || true
    start_sandbox
  else
    log "Rebuilding Tandem Docker image..."
    local build_args=(build)
    if [ "${REBUILD_NO_CACHE}" -eq 1 ]; then
      build_args+=(--no-cache)
    fi
    (cd "${ROOT_DIR}" && docker compose "${build_args[@]}")
    (cd "${ROOT_DIR}" && docker compose up -d --force-recreate)
    wait_for_ready
    display_and_open_pairing
  fi
}

function logs_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
    sbx exec "${SANDBOX_NAME}" cat /tmp/tandem.log
  else
    if [ -t 1 ]; then
      (cd "${ROOT_DIR}" && docker compose logs --tail 200 -f tandem)
    else
      (cd "${ROOT_DIR}" && docker compose logs --tail 200 tandem)
    fi
  fi
}

function shell_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
    log "Attaching interactive bash shell to ${SANDBOX_NAME}..."
    exec sbx exec -it "${SANDBOX_NAME}" /bin/bash
  else
    log "Attaching interactive bash shell to Docker Compose container..."
    exec docker compose -f "${ROOT_DIR}/compose.yaml" exec -it tandem /bin/bash
  fi
}

function status_sandbox() {
  if [ "${RUNTIME}" = "sbx" ]; then
    log "Runtime: Docker Sandboxes (sbx)"
    sbx ls
  else
    log "Runtime: Docker Compose (docker)"
    (cd "${ROOT_DIR}" && docker compose ps)
  fi
  echo ""
  if curl -s "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' >/dev/null 2>&1; then
    echo -e "\033[1;32m[Health Probe]\033[0m Tandem server is active and healthy on http://127.0.0.1:${PORT}"
  else
    echo -e "\033[1;33m[Health Probe]\033[0m Tandem server is not responding on http://127.0.0.1:${PORT}"
  fi
}

COMMAND="${1:-start}"
REBUILD_NO_CACHE=0
if [ "$#" -gt 0 ]; then
  shift
fi
if [ "$#" -gt 0 ]; then
  if [ "${COMMAND}" != "rebuild" ] || [ "$#" -ne 1 ] || [ "$1" != "--no-cache" ]; then
    error "Unexpected arguments for ${COMMAND}: $*"
    usage
    exit 1
  fi
  REBUILD_NO_CACHE=1
fi

detect_runtime
check_prerequisites

case "${COMMAND}" in
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
    rebuild_sandbox
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
    usage
    exit 1
    ;;
esac
