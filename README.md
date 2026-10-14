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

Use your phone or another computer over the internet, without sharing a Wi-Fi network or forwarding router ports. This publishes **Tandem itself**, not your project's preview server. The Tandem host must stay awake and running; the server still binds only to `127.0.0.1`.

#### Before you start

- Have a Cloudflare account and a domain whose DNS is managed by Cloudflare. Choose an unused hostname, such as `tandem.example.com`; replace it in every example below with yours.
- Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) on the **Tandem host** (`brew install cloudflared` on macOS). For CLI creation, install it on the creating machine too.
- Run Tandem on its default port, `4820`. The origin service is `http://127.0.0.1:4820`, not HTTPS. The public address is `https://tandem.example.com`.
- Configure a Cloudflare Access self-hosted application for that hostname, allowing only your identity. Access is an extra gate, not a replacement for Tandem device pairing.

Choose one route:

| Situation | Route |
|---|---|
| Create in a browser, on any machine | Dashboard + token below |
| Create and run on your own private machine | Same-machine CLI |
| Create on machine A, run Tandem on machine B | Two-machine instructions below; B receives only a connector token |

#### Create through the Cloudflare website (same machine or two machines)

1. On your trusted machine, open the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/). Go to **Networks → Connectors → Cloudflare Tunnels** (some dashboard versions call this **Networks → Tunnels**).
2. Choose **Create a tunnel → Cloudflared**, name it (for example `tandem`), and save it.
3. The connector installation page shows a command ending in a long token. Copy **only the token**, not the whole command. Do not run that service-install command: Tandem will run the connector itself. It is normal for the tunnel to be offline for now.
4. Add a **Published application route** (also called **Public hostname**): subdomain `tandem`, domain `example.com`, no path, service type **HTTP**, URL **127.0.0.1:4820**. Save it. This creates the DNS route too.
5. In the Tandem app served by the **Tandem host**, open **Public access** in the sidebar. The **Cloudflare website** tab lists the setup steps together on one page. Under **Publish from Tandem**, enter `https://tandem.example.com` and the tunnel token, then click **Publish**. Wait for **Published at**.

For two machines, steps 1–4 happen on A; step 5 configures Tandem on B. Transfer the token privately. `127.0.0.1` means **B**, where Tandem runs the connector, not A or your phone. A can be switched off afterward. B never needs `cloudflared tunnel login` or your account certificate.

Instead of the dialog, configure B from its Tandem checkout:

```bash
bun run tunnel configure --public-url https://tandem.example.com --token-file -
# Paste only the token, press Enter, then Ctrl-D to end input.
```

`configure` reloads an installed Tandem service (interrupting active work). Without a service, stop any foreground Tandem process and run `bun run start` again. The dialog's **Publish** starts the connector without restarting Tandem. Do not run a separate `cloudflared` service alongside it.

#### Same machine: create with the cloudflared CLI

On a machine that is **yours alone**, run this from the Tandem checkout:

```bash
brew install cloudflared   # macOS; see the installation link above for other systems
bun run tunnel setup --public-url https://tandem.example.com
```

Tandem calls `cloudflared tunnel login`, opens the approval page, then calls `cloudflared tunnel create` and `cloudflared tunnel route dns`. Approve the domain in your browser. It writes the local ingress configuration pointing to `http://127.0.0.1:4820`; no token needs copying. An installed Tandem service is reloaded automatically; otherwise restart with `bun run start`.

For instructions in the app, open **Public access → CLI**, then choose **Same machine** or **Two machines**. All steps for your chosen setup are shown together, with a copy button beside each command. Run the commands in your terminal; the dialog does not run CLI commands for you.

This leaves `~/.cloudflared/cert.pem` on the host, with authority to manage tunnels and domain DNS, plus the tunnel's credentials. Do not use this route on a shared machine or sync its credentials. Use the dashboard/token route instead. `setup` writes `~/.tandem/cloudflared.yml`; choosing the token route later replaces that local configuration.

#### Two machines: create with CLI on A, run Tandem on B

On **A, your trusted personal machine**, from a Tandem checkout:

```bash
bun run tunnel create --public-url https://tandem.example.com
```

This wraps `cloudflared tunnel login`, `create`, `route dns`, and `token`. Approve the domain when prompted. Keep the account certificate and tunnel credentials on A; do not copy `~/.cloudflared` to B. Only the connector token printed at the end is intended for B.

**Cloudflare configuration matters:** `cloudflared tunnel create` creates a locally managed tunnel. Before using its token alone on B, migrate that tunnel to remote management in the Cloudflare dashboard and configure its published application route as in step 4 above. A DNS record by itself does not configure the origin service. Alternatively, create a remotely managed tunnel in the dashboard from the start.

On **B, the Tandem host**, install `cloudflared`, then paste the token into **Public access**, or run:

```bash
bun run tunnel configure --public-url https://tandem.example.com --token-file -
# Paste the token, press Enter, then Ctrl-D.
```

Restart foreground Tandem if needed, as above. Do not run `tunnel setup` or `cloudflared tunnel login` on B. A is only needed to manage the tunnel, not to keep it running. `create` does not configure Tandem on A, but Cloudflare's login and creation commands do leave credentials there. Existing DNS records are not overwritten unless you explicitly pass `--force` to `create` or `setup`.

The connector token can run this one tunnel, not manage account DNS. Treat it as a secret: transfer it privately, never put it in a command argument or commit it, and rotate it in Cloudflare if exposed. `configure` accepts standard input or `--token-file <path>` and stores it in `~/.tandem/tunnel.json` with mode `0600`.

#### Connect your phone and check the result

1. Wait for **Public access** to show **Published at**, then open the HTTPS address on your phone (mobile data works).
2. Pass Cloudflare Access if configured. In an already paired Tandem browser, open **Devices** and create a pairing link. Open that public-hostname link on your phone within five minutes; it works once. Never send a `127.0.0.1` or `localhost` link to the phone.
3. After pairing, bookmark the HTTPS address. Keep the Tandem host awake; use `bun run service install` if it should survive closing your terminal.

Check locally with `bun run tunnel status --verify` and `bun run service status`. If the connector is connected but the public page fails, check the published application route, DNS, and that Tandem answers at `http://127.0.0.1:4820` on the host. A connected tunnel alone does not prove the hostname routes to Tandem.

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
