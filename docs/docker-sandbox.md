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

## 2. Quick Start with Docker Compose

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

## 3. Persistent Data & Workspace Mounting

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

## 4. Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `TANDEM_HOST` | `0.0.0.0` | Container listening interface (allows Docker port mapping). |
| `TANDEM_HOME` | `/data` | State and SQLite database directory. |
| `TANDEM_ALLOWED_ORIGINS` | _(none)_ | Comma-separated list of additional allowed HTTP origins if mapping to a custom host port. |
