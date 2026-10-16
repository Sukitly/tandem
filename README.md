# Tandem

A local-first agent product you work with, not hand tasks to.

Tandem runs on your machine and lets you collaborate with an AI coding agent on local Git repositories from the browser: steer it while it works, review its live diffs, leave code comments in context, use an integrated terminal, and preview your applications.

Conversations are durable—surviving page reloads, dropped connections, and backend restarts without losing state. Tandem is built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable).

> **Status:** Early development. Native runs are not sandboxed: agents and terminals run with your machine account's permissions. Docker runs execute inside a container, but agents can still modify files in mounted host directories.

---

## Features

- **Local-First & Durable:** Full conversation history, task graphs, and workspaces persist across restarts in a local SQLite database.
- **Interactive Review & Diffs:** Review agent modifications in real time with side-by-side git diffs.
- **In-Context Code Comments:** Leave comments on specific code lines; the agent replies directly in thread to address reviews.
- **Integrated Terminals:** Persistent pseudo-terminals (`node-pty`) run in your project directories and outlive browser tabs.
- **Flexible Model Support:** Use Anthropic, OpenAI, Google, and other providers via `pi-ai`, or test locally with `TANDEM_FAUX=1` (no credentials needed).
- **Secure Pairing:** Single-use 128-bit pairing links authenticate browsers with `HttpOnly`, `SameSite=Strict` cookies. Credentials never touch URLs or `localStorage`.
- **System Service Management:** Built-in CLI to run Tandem as a persistent background service (macOS launchd or Linux systemd).
- **Remote & Mobile Access:** Access Tandem from a phone or remote machine over Cloudflare Tunnels protected by Cloudflare Access.

---

## Prerequisites

- **[Bun](https://bun.com):** Package manager and script runner for both native and Docker commands.
- **Native runs:** [Node.js](https://nodejs.org) >= 22.19 is required for the backend (`node:sqlite`). Prebuilt binaries for [node-pty](https://github.com/microsoft/node-pty) are included for macOS, Linux (x64, arm64), and Windows. Other platforms require a C++ compiler, Python, and `make`.
- **Docker runs:** A running Docker Desktop or Docker Engine with the Compose plugin (v2 or later), plus Bash and `curl` on the host. Node.js and application dependencies are installed inside the image; host Node.js and `bun install` are not required to start the container.

---

## Quick Start (Native)

Use `bun run start` to run directly on your machine. To run in Docker instead, use `bun run sandbox` and follow [Running in Docker](#running-in-docker).

Run all commands below from the repository root.

### 1. Install & Start

```bash
bun install
bun run start
```

This builds the web application, starts the backend on `127.0.0.1:4820`, and opens your default browser with a secure one-use pairing link.

### 2. Pairing & Workflow

- **Browser Pairing:** The initial pairing link is valid for 5 minutes. Once paired, your browser authenticates via a secure cookie. Running `bun run start` again opens the running instance.
- **Add a Project:** Point Tandem to a local Git repository on your machine.
- **Chat & Review:** Start a conversation. The right panel displays the project file tree and live git changes. Clicking file links in agent responses opens the file or diff directly.
- **Configure Providers:** Sign in to model providers in the sidebar under **Model providers**, or supply environment variables (e.g. `ANTHROPIC_API_KEY`).

### Useful Start Flags

```bash
bun run start --no-open       # Print pairing link without opening browser
bun run start --port 4821     # Specify a custom port
bun run dev                   # Development mode: backend watch + Vite dev server
```

---

## Running in Docker

Use Tandem's `bun run sandbox` commands to build, start, and manage the container. You do not need to run Docker Compose commands directly or install Tandem as a host background service.

Run the following commands from the repository root, with Docker Desktop or Docker Engine running.

### 1. Configure Project Mounts

By default, the repository's `workspace/` directory is mounted at `/workspace` inside the container. To use a different host directory without changing the shared `compose.yaml`, create **`compose.override.yaml`** alongside it. For example, to mount **`~/Codes`**:

```yaml
services:
  tandem:
    volumes:
      - "${HOME}/Codes:/workspace"
```

Docker Compose automatically merges this local override with `compose.yaml`. Volume entries are merged by container target path, so this replaces the default `/workspace` mount while preserving the separate `/data` volume. `${HOME}` expands to your host home directory; you do not need to export `TANDEM_WORKSPACE_DIR` on every launch. Override files are already ignored by Git.

In Tandem's **Add project** workflow, use container paths, not host paths:

| Host repository | Path to use in Tandem |
|---|---|
| `~/Codes/my-project` | `/workspace/my-project` |
| `~/Codes/open-source/tandem` | `/workspace/open-source/tandem` |

**Mounted files are writable:** agent and terminal changes under `/workspace` affect the corresponding files on your host. Mount only directories you want Tandem to access.

**Inherited host configurations:** Tandem automatically inherits your prompt commands (`~/.pi/agent/prompts`) through a read-only mount, so your agent slash commands work seamlessly inside the container.

### 2. Start Tandem

```bash
export TANDEM_RUNTIME=docker
bun run sandbox
```

The runner builds the image if needed, starts the container in the background, waits for the health check, and prints a pairing link. On macOS, it also opens the link in your browser. The web interface is available at `http://127.0.0.1:4820`.

Set `TANDEM_RUNTIME=docker` in each new terminal where you use these commands, or add the export to your shell profile. Without an explicit runtime, the runner reuses an existing runtime or prefers Docker Sandboxes (`sbx`) when available. Compose overrides apply only to Docker Compose mode, not `sbx` microVMs.

Once paired, sign in under **Model providers** and add a project using its `/workspace/...` path. For subsequent starts, run `bun run sandbox` again with the same runtime setting.

### 3. Apply Mount or Configuration Changes

If you add or edit `compose.override.yaml` after the container has already been created, run:

```bash
export TANDEM_RUNTIME=docker
bun run sandbox rebuild
```

This rebuilds the image using Docker's build cache and recreates the container with the merged configuration. Unchanged system tools and dependencies can reuse cached layers; changed layers and the layers after them are rebuilt. A plain `bun run sandbox` reuses an already healthy container, and `bun run sandbox restart` only restarts it; neither applies new mounts to that running container.

To explicitly rebuild without the layer cache, for example when troubleshooting a cached installation, run:

```bash
bun run sandbox rebuild --no-cache
```

This reruns installation and build steps and can take substantially longer. Both rebuild modes preserve the `tandem_data` volume.

### Management & Persistent Data

With `TANDEM_RUNTIME=docker` set:

```bash
bun run sandbox           # Start or reuse the container and display the pairing link
bun run sandbox status    # Check container status and server health
bun run sandbox logs      # View logs (follows in an interactive terminal)
bun run sandbox shell     # Open a shell inside the container
bun run sandbox restart   # Restart the existing container without applying config changes
bun run sandbox stop      # Stop the container
bun run sandbox rm        # Remove the container while retaining the data volume
```

Conversations, paired devices, model credentials, and settings are stored at `/data` in the persistent Docker volume **`tandem_data`**, separately from the native `~/.tandem` directory. They survive container stops, rebuilds, and `bun run sandbox rm`. Deleting the `tandem_data` volume deletes this state. Project files remain in the mounted host directory.

The container runs in the background and continues running when you close the terminal; `bun run service install` is only for native deployments.

---

## Development Commands

| Task | Command |
|---|---|
| Start full dev environment (backend watch + Vite) | `bun run dev` |
| Start backend in watch mode | `bun run dev:server` |
| Start web frontend | `bun run dev:web` |
| Run all automated tests | `bun run test` |
| Run tests for a specific package | `bun run --filter <package> test` |
| Lint, format, and typecheck | `bun run check` |
| Apply safe formatting and lint fixes | `bunx biome check --write .` |
| Build all packages | `bun run build` |

---

## Running as a Background Service

The following commands are for native deployments. Docker deployments use the [sandbox management commands](#management--persistent-data) instead.

Running Tandem in the foreground terminates the process when the terminal closes. Use the built-in service manager to register Tandem as a launchd agent (macOS) or systemd user unit (Linux):

```bash
bun run service install        # Install and start the background service
bun run service pair           # Generate a fresh pairing link for a new browser
bun run service status         # Check service status and health
bun run service restart        # Rebuild the web app and restart the service
bun run service update         # Safely pull, test, build, restart, and rollback if unhealthy
bun run service uninstall      # Stop and remove the service
```

### Service Details

- **Logs:** Written to `$TANDEM_HOME/tandem.log` on macOS, or viewed via `journalctl --user -u tandem -f` on Linux.
- **Linux Linger:** Run `loginctl enable-linger $USER` to ensure the service runs when logged out.
- **Environment:** The service automatically inherits node paths and environment variables configured during installation.

---

## Remote & Mobile Access

Tandem supports secure remote access over the internet without port forwarding using Cloudflare Tunnels and Cloudflare Access.

### Setup Instructions

1. **Create Tunnel in Cloudflare:**
   - Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels**.
   - Create a tunnel (e.g. `tandem-remote`) and copy the connector token.
2. **Connect Machine in Tandem:**
   - In Tandem, navigate to **Public access** (`/#public-access`).
   - Enter your public domain (e.g. `https://tandem.example.com`) and paste the connector token, then click **Publish**.
3. **Protect Hostname with Cloudflare Access (Required):**
   - Go to **Access** → **Applications** → **Add an Application** → **Self-hosted**.
   - Set the public hostname to `tandem.example.com`.
   - Add a policy allowing only your email address. Verify that accessing the URL in an incognito window blocks access until identity is authenticated.
4. **Publish Application Route:**
   - In the Cloudflare Tunnel configuration, add a public hostname route pointing `tandem.example.com` to HTTP service `127.0.0.1:4820`.
5. **Pair Remote Device:**
   - From an already paired device, open **Devices** in Tandem and generate a pairing link.
   - Open that public link on your phone or remote browser to pair.

---

## State & Devices (`$TANDEM_HOME`)

Tandem stores all state in `$TANDEM_HOME` (default: `~/.tandem` for native runs; `/data` in the `tandem_data` volume for Docker Compose runs):

- **Data storage:** `app.sqlite` stores conversations, tasks, and project records.
- **Master key:** `server.json` (mode `0600`) stores the local installation master key used for CLI operations.
- **Paired devices:** `devices.json` (mode `0600`) stores hashed session credentials.
- **Recovery codes:** Generate recovery codes in **Devices** to pair new browsers if current sessions are lost.
- **Credentials:** Model credentials in `auth.json` (mode `0600`) remain strictly on the backend.

---

## Repository Layout

| Path | Package | Purpose |
|---|---|---|
| `apps/server` | `@tandem/server` | Backend process hosting the pi-durable Harness, RPC services, and pty terminals |
| `apps/web` | `@tandem/web` | Frontend single-page app built with React, Vite, Tailwind CSS, and shadcn/ui |
| `packages/contracts` | `@tandem/contracts` | Shared types, RPC interfaces, and constants (runtime-neutral) |
| `packages/client` | `@tandem/client` | Client library for WebSocket RPC, service bindings, and terminal connections |

For contributing guidelines and architectural rules, see [AGENTS.md](AGENTS.md) and [SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE)
