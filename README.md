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
bun run service pair              # print a fresh pairing link, without building or restarting
bun run service restart           # rebuild the web app and start it again, after new code
bun run service status            # what the service manager says, and whether it answers
bun run service install --print   # show the file without writing or loading it
bun run service uninstall
```

`install` builds the web app if it has not been built, then refuses while a server that is not this service holds the port: the service would find that one, print its pairing link, and exit with nothing running. It creates the state directory at `0700`, writes the file, loads it, and waits until the service is both running and answering. Everything an init system needs is absolute and it reads no shell configuration, so the values are computed rather than typed: Node's path from the process that runs this (a version manager's per-shell shim never reaches the service, which would break at your next login), this repository from its own location, the state directory from `TANDEM_HOME`, and the public origin from `TANDEM_PUBLIC_URL` if the environment you install from sets it.

After `install`, open the printed pairing link to authorize your first browser. Links expire in five minutes and can be used once. Run `bun run service pair` for a fresh link without building or restarting; use the same `TANDEM_HOME` as the service. If link generation fails, the service stays running and the command reports the pairing failure separately. A service has no terminal, so nothing opens at login. Once paired, open the base URL directly. What the agent reads and the terminals it opens inherit the service's `PATH`: the one you installed from, without the entries that no longer exist. On Linux, `loginctl enable-linger $USER` keeps it running while you are logged out. To stop it for good: `launchctl kill SIGTERM gui/$(id -u)/com.tandem.server`, or `systemctl --user stop tandem`. After updating the code, `git pull && bun install && bun run service restart` rebuilds the web app and starts the server again. `uninstall` stops the service and removes its file only once it is really gone: if it cannot be stopped, the file stays and the failure is reported. Nothing under `$TANDEM_HOME` is touched, so conversations, paired devices, and the master key stay until that directory is deleted. Output goes to `$TANDEM_HOME/tandem.log` on macOS, and to the journal on Linux (`journalctl --user -u tandem -f`). macOS lists a background item under the identity of the program it runs, so **System Settings → General → Login Items** shows this one as Node.js Foundation, not by name; `bun run service status` and `launchctl print gui/$(id -u)/com.tandem.server` name it properly.

### Remote access

The server still binds only to `127.0.0.1`, so reaching it from outside this machine means a Cloudflare Tunnel in front of it. Tandem runs the tunnel itself, as a child of the server, so it starts and stops with the server and one service covers both.

Install `cloudflared` (`brew install cloudflared`; Tandem does not download it), then name the address you want:

```bash
bun run tunnel setup --public-url https://tandem.example.com
bun run service restart
bun run tunnel status --verify    # configured origin, and whether the tunnel really connects
```

`setup` does the Cloudflare work for you. It authorizes this machine once (`cloudflared tunnel login`, which opens a browser), creates the tunnel, points that hostname at it, and writes `~/.tandem/cloudflared.yml` with a single ingress rule sending it to `http://127.0.0.1:4820` and refusing everything else. The origin it records in `~/.tandem/tunnel.json` becomes Tandem's public origin, so pairing links carry it and its cookies are `Secure`; `--public-url`, `TANDEM_PUBLIC_URL`, and `publicUrl` in `settings.json` still override it. `--force` replaces a DNS record that is already there; without it, `setup` stops and says so. That path needs no token, because a tunnel this machine manages itself has none.

A tunnel that a **dashboard** describes is the other way, and then a token is unavoidable:

```bash
pbpaste | bun run tunnel configure --public-url https://tandem.example.com
```

`configure` reads the connector token from standard input or from `--token-file <path>`, never from an argument, and keeps it in `~/.tandem/tunnel.json` at 0600. That token travels to `cloudflared` in the child's environment, and `cloudflared.yml` wins over it when both are present.

The same thing is in the app: **Public access** in the sidebar footer takes the address, opens the approval page, and reports what the tunnel is doing, so publishing does not require a terminal. Everything the tunnel needs — the approval URL, whether it connected, why it did not — is in the `PublicAccess` service and in `/health`.

The server reports the tunnel as `starting`, `connected`, `failed`, or `unavailable` in `/health`, which `bun run service status` prints. A failed tunnel is started again, backing off to a minute. The hop to `127.0.0.1` is kept off any proxy, while an installer's `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` are carried into the service file. Previewing an app that a terminal started over the tunnel is not implemented yet: the tunnel publishes the one port the server listens on.

An explicit public origin is required for WebSocket and pairing checks; proxy headers do not grant access. Configure **Cloudflare Access** in front of the tunnel to allow only your identity. A tunnel alone is not authentication, and Access JWT-based automatic login and passkeys are not implemented.

Authenticated devices have full control of this machine, not just the open repositories. The tunnel provider terminates TLS and can inspect traffic, so anyone who obtains the tunnel token can run a connector of their own and read that traffic. A pairing link grants access to anyone who redeems it before it expires.

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
