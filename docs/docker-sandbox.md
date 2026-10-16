# Docker Sandbox Deployment for Tandem

This document describes how to run Tandem inside an isolated Docker Sandbox environment. Running Tandem in a containerized sandbox eliminates the risk of host machine takeover, file exfiltration, and unauthorized system access by AI agents or untrusted dependencies.

---

## 1. Security Architecture & Isolation

| Boundary | Host Machine | Docker Sandbox Container |
| :--- | :--- | :--- |
| **Filesystem** | Host files, `~/.ssh`, `~/.aws`, system directories are completely inaccessible. | Isolated container filesystem. Only explicitly mounted directories (`/workspace` and `/data`) are visible. |
| **Execution** | No child processes or shells run on the host. | Agent tools (`bash`, `git`, `python`, etc.) and PTY terminals run inside the container with restricted capabilities. |
| **Privileges** | Host user privileges remain untouched. | `no-new-privileges: true` enforced; Linux capabilities dropped via `cap_drop: [ALL]`. |
| **Network** | Intranet interface is not exposed. | Port binding is strictly restricted to host loopback (`127.0.0.1:4820`). |

---

## 2. One-Click Launch (`bun run sandbox`)

Tandem provides an integrated one-click runner supporting dual container runtimes:
- **Docker Sandboxes (`sbx` microVM)**: Hardware-isolated microVMs via Apple Virtualization Framework / KVM.
- **Docker Compose (standard container)**: Hardened container isolation (`cap_drop: [ALL]`, `no-new-privileges: true`, loopback-only binding).

### Automatic Runtime Detection & Fallback

When you run `bun run sandbox`:
1. **Auto Detection**: If Docker Sandboxes CLI (`sbx`) is installed and available, it runs inside a dedicated microVM.
2. **Graceful Fallback**: If `sbx` is not installed or the machine does not support microVM hypervisors (e.g. Hackintosh, older Intel Macs, or non-desktop Linux hosts), it **automatically falls back to standard Docker Compose**, providing the exact same one-click launch, automatic ready-check polling, pairing link extraction, and browser opening experience!

You can also explicitly select your runtime using `TANDEM_RUNTIME`:
```bash
# Explicitly use standard Docker container mode (ideal for Hackintosh)
export TANDEM_RUNTIME=docker
bun run sandbox

# Explicitly require Docker Sandboxes microVM
export TANDEM_RUNTIME=sbx
bun run sandbox
```

### Starting the Sandbox

Simply run:
```bash
bun run sandbox
```

This single command automatically:
1. Detects available runtime (`sbx` or `docker compose`).
2. Builds and starts the container or microVM with port `127.0.0.1:4820` published.
3. Polls the `/health` endpoint until the server is fully ready.
4. Automatically extracts the single-use pairing URL and opens your host browser!

### Management Commands

All subcommands work transparently across both runtimes:

```bash
bun run sandbox           # Start sandbox, launch Tandem, and open browser
bun run sandbox reload    # Reload and restart Tandem inside the sandbox
bun run sandbox update    # Pull latest git commits, rebuild, and update sandbox with auto-rollback
bun run sandbox status    # Check running sandbox status and health probe
bun run sandbox logs      # View Tandem logs inside the sandbox (follows in interactive terminal)
bun run sandbox shell     # Open an interactive bash shell inside the container/microVM
bun run sandbox stop      # Stop the sandbox
bun run sandbox rm        # Remove the sandbox
bun run sandbox rebuild   # Rebuild using cached layers and recreate the container
bun run sandbox rebuild --no-cache  # Rebuild without cached layers and recreate the container
```

Rebuilds use Docker's layer cache by default in both runtime modes. Unchanged system tools and dependencies can reuse cached layers. Use `--no-cache` only when you need installation and build steps to run again; it can take substantially longer. In `sbx` mode, either rebuild also reloads the image into the template store and recreates the microVM.

---

## 3. Alternative: Manual Docker Compose Deployment

### Prerequisites
- Docker Engine or Docker Desktop running.

### Launching the Sandbox

1. **Start the container in the background**:
   ```bash
   docker compose up -d --build
   ```

2. **Retrieve the single-use pairing link**:
   ```bash
   docker compose logs tandem
   ```
   Look for the output line:
   ```text
   Open http://localhost:4820/pair#<pairing-token>
   ```

3. **Open the pairing URL in your host browser**:
   Navigate to the printed link in Chrome/Safari/Firefox to pair your browser session securely.

---

## 4. Persistent Data & Workspace Mounting

### Persistent State
Tandem stores conversation histories, task snapshots, paired devices, and model API credentials in `/data` inside the container. This is mapped to the named volume `tandem_data` defined in `compose.yaml`, surviving container restarts and image updates.

### Mounting Host Repositories into the Sandbox
To work on your local repositories inside the sandbox, mount your projects directory into `/workspace`.

Edit `compose.yaml`:
```yaml
    volumes:
      - tandem_data:/data
      # Map your host projects folder into /workspace
      - /path/to/your/projects:/workspace
```

Inside Tandem's web UI, click **Add project** and choose `/workspace` (or subdirectories under `/workspace`).

---

## 5. Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `TANDEM_RUNTIME` | `auto` | Runtime selector: `auto` (sbx with docker fallback), `docker` (force Docker Compose), or `sbx` (force microVM). |
| `TANDEM_WORKSPACE_DIR` | `./workspace` | Host directory mounted into `/workspace` inside the container/sandbox. |
| `TANDEM_HOST` | `0.0.0.0` | Container listening interface (allows Docker port mapping). |
| `TANDEM_HOME` | `/data` | State and SQLite database directory. |
| `PORT` | `4820` | Published loopback port on host (`127.0.0.1:<PORT>`). |
| `TANDEM_ALLOWED_ORIGINS` | _(none)_ | Comma-separated list of additional allowed HTTP origins if mapping to a custom host port. |
