# Tandem

A local-first agent you work with, not hand tasks to.

Tandem runs on your own machine and lets you work with an agent on your Git repositories from the browser: steer it while it works, review its diffs, leave code comments for it, use a terminal, and preview the app you are building. Conversations are durable, so a page reload, a dropped connection, or a backend restart does not lose any work.

Tandem is built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable).

> **Status:** early development. There is no sandbox: agents and terminals run with your machine account's permissions.

## Run

Requires [Bun](https://bun.com) for installing and running scripts, and [Node.js](https://nodejs.org) 22.19 or later for the backend. Terminals use [node-pty](https://github.com/microsoft/node-pty), a native module with prebuilt binaries for macOS, Linux (x64 and arm64), and Windows; on other platforms it builds on install and needs Python, `make`, and a C++ compiler.

```bash
bun install
bun run start       # builds the web app, serves it on 127.0.0.1:4820, and opens the browser
```

The browser opens a one-use pairing link, valid for five minutes. The same link is printed if your machine cannot open a browser. Once paired, your browser reconnects using an HttpOnly cookie; credentials are never stored in localStorage or WebSocket URLs. Running the command again opens the existing server instead of starting another, at the page that server serves: during `bun run dev` that is Vite's address, not the backend's. Add a project, a directory on your machine, then start a conversation in it. Its files and its changes show in the panel on the right, as tabs; file links in the agent's answers open there, and the changes follow the files on disk as the agent edits them. Sign in to a model provider from **Model providers** in the sidebar; API keys in the server's environment (such as `ANTHROPIC_API_KEY`) work without signing in. To try the UI without any provider, start the server with `TANDEM_FAUX=1` for a local fake model that thinks, calls tools, and answers.

Data is kept in `~/.tandem`; set `TANDEM_HOME` to use another directory. Use **Devices** in the sidebar to pair another browser, revoke devices, or generate recovery codes. Save recovery codes in your password manager: each can pair one device when none of your paired devices are available. Revocation immediately disconnects the device's RPC and terminal connections; a device with no activity for 30 days must pair again.

```bash
bun run start --no-open              # print a pairing link without opening the browser
bun run start --port 4821            # choose a port if 4820 is occupied
bun run dev                         # server watch mode + Vite, opens once; Ctrl-C stops both
```

Stop a running server before switching to development mode. `bun run dev:server` and `bun run dev:web` remain available separately.

### Keep it running

`bun run start` runs in the foreground, so closing the terminal window ends the server: a closing terminal sends `SIGHUP`, and Node does not keep the `SIG_IGN` that `nohup` sets, so `nohup bun run start` ends the same way. (On Node 24, `nohup sleep` survives a hangup and `nohup node` does not.) A service manager is the answer, and it brings start-at-login and restart-after-a-crash with it.

```bash
bun run service install           # a launchd agent on macOS, a systemd user unit on Linux
bun run service status            # what the service manager says, and whether it answers
bun run service install --print   # show the file without writing or loading it
bun run service uninstall
```

`install` builds the web app if it has not been built, refuses while another program holds the port, writes the file, loads it, and waits until it answers. Everything an init system needs is absolute and it reads no shell configuration, so the values are computed rather than typed: Node's path from the process that runs this (a version manager's per-shell shim never reaches the service, which would break at your next login), this repository from its own location, and the state directory from `TANDEM_HOME`.

A service has no terminal, so nothing opens at login. Run `bun run start` when you want a pairing link: it finds the running server and prints a fresh one. What the agent reads and the terminals it opens inherit the service's `PATH`: the one you installed from, without the entries that no longer exist. On Linux, `loginctl enable-linger $USER` keeps it running while you are logged out. To stop it for good: `launchctl kill SIGTERM gui/$(id -u)/com.tandem.server`, or `systemctl --user stop tandem`. After updating the code, `git pull && bun install && bun run build`, then `launchctl kickstart -k gui/$(id -u)/com.tandem.server`, or `systemctl --user restart tandem`. Output goes to `$TANDEM_HOME/tandem.log` on macOS, and to the journal on Linux (`journalctl --user -u tandem -f`).

### Remote access

The server still binds only to `127.0.0.1`. For a fixed Cloudflare Tunnel domain, start with:

```bash
bun run start --public-url https://tandem.example.com
```

`TANDEM_PUBLIC_URL` or `publicUrl` in `~/.tandem/settings.json` can also configure the public origin. An explicit origin is required for WebSocket and pairing checks; proxy headers do not grant access. Public-origin cookies are Secure. Configure **Cloudflare Access** in front of the tunnel to allow only your identity. Tunnel setup and a real public-domain browser check are still required; a tunnel alone is not authentication. Access JWT-based automatic login and passkeys are not implemented.

Authenticated devices have full control of this machine, not just the open repositories. The tunnel provider terminates TLS and can inspect traffic. A pairing link grants access to anyone who redeems it before it expires.

`server.json` contains the installation's **master key**, for local launch commands and non-browser clients only. It is accepted in `Authorization: Bearer`, never in a URL. The upgrade from legacy URL-token authentication rotates that key once while keeping the server identity and conversations intact. Stop the old server before starting this version; existing browsers must pair again.

| Command | Purpose |
|---|---|
| `bun run check` | Biome lint and format check, then typecheck |
| `bun run test` | Run all tests |
| `bun run build` | Build all packages |

## Repository layout

| Path | Purpose |
|---|---|
| `apps/server` | Backend process |
| `apps/web` | React + Vite web app |
| `packages/contracts` | Code shared by server and clients |
| `packages/client` | Client library for connecting to the server |

## License

[MIT](LICENSE)
