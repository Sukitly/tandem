# Tandem

A local-first agent product you work with, not hand tasks to.

Tandem runs on your machine and lets you collaborate with an AI coding agent on local Git repositories from the browser: steer it while it works, review its live diffs, leave code comments in context, use an integrated terminal, and preview your applications.

Conversations are durable—surviving page reloads, dropped connections, and backend restarts without losing state. Tandem is built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable).

> **Status:** Early development. There is currently no sandbox: agents and terminals run with your machine account's permissions.

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

- **[Bun](https://bun.com):** Package manager and script runner.
- **[Node.js](https://nodejs.org) >= 22.19:** Required to run the backend (uses `node:sqlite`).
- **Platform Support:** Prebuilt binaries for [node-pty](https://github.com/microsoft/node-pty) are included for macOS, Linux (x64, arm64), and Windows. Other platforms require a C++ compiler, Python, and `make`.

---

## Quick Start

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

Tandem stores all state in `$TANDEM_HOME` (default: `~/.tandem`):

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
