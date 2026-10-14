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

Open **Public access** from the sidebar, or go to `/#public-access` directly. The page is bookmarkable and returns to your conversation with **Back to workspace**. Every step there says where you are operating and what finishing it looks like; the notes below are the same flow in plain text.

Set up one hostname for the whole flow, e.g. `tandem.example.com`. A tunnel name is only a label, creating a tunnel does not bind a domain, and entering an address in Tandem does not configure Cloudflare. Run Tandem on its default port `4820`; the origin service is `http://127.0.0.1:4820`, not HTTPS.

#### Create through the Cloudflare website

1. **In Cloudflare, create the tunnel.** Open [Cloudflare Tunnels](https://dash.cloudflare.com/?to=/:account/tunnels), select your account, and choose **Create a tunnel**. Name it (e.g. `tandem-macbook`) and save. Cloudflare displays the connector setup page showing **Install and run a connector**.
2. **In Tandem, connect this machine.** On the Cloudflare page from step 1, copy the token string after `--token` under **Or, run tunnel (manual)** (or copy the entire command). Open **Public access**, enter `https://tandem.example.com` and the token, and click **Publish**. The page reports **Tunnel connected**.
3. **In Cloudflare, protect the hostname.** Follow [Protect the hostname with Cloudflare Access](#protect-the-hostname-with-cloudflare-access) below, using `tandem.example.com` without `https://`. Do this before the route exists, so the address is never reachable unprotected.
4. **In Cloudflare, publish the route.** Jump directly to your tunnel via **Open Tunnel in Cloudflare** on the Public access page (or click **Continue** on the page from step 1). Go to **Routes → Add route → Published application**. Set Subdomain `tandem`, Domain your domain, Path empty, Service type **HTTP**, URL `127.0.0.1:4820`, and save. Cloudflare creates the DNS record, and the hostname now reaches Tandem through this tunnel.
5. **On your phone, verify and pair.** In a private window, open `https://tandem.example.com` and confirm Cloudflare asks you to log in before Tandem appears, that your email gets in, and that an unlisted email is refused. Then follow [Connect your phone and check the result](#connect-your-phone-and-check-the-result).

#### Protect the hostname with Cloudflare Access

A connected tunnel does **not** mean Access is configured. Tandem does not inspect or verify your Cloudflare policies. Complete these steps for both dashboard and CLI setups before pairing your phone; configure Access before adding the public route when possible to avoid an unprotected interval.

1. Open [Cloudflare Access applications](https://one.dash.cloudflare.com/?to=/:account/access-controls/apps). Sign in and select your account if prompted, then choose **Add an application → Self-hosted**.
2. Name it **Tandem**. Set **Public hostname** to your Tandem hostname, such as `tandem.example.com` (without `https://`). Leave **Path** empty to protect the entire site.
3. Add an access policy: **Action → Allow**, **Include → Emails**, then enter your exact email address. Do not choose **Everyone** or **Bypass**. Remove any existing broad allow or bypass policies covering this hostname.
4. Select your identity provider, or enable **One-time PIN** in Zero Trust login methods and select it for the application to sign in by email code. Save the application and policy.
5. After configuring the tunnel's public route, open the HTTPS address in a private browser window. Cloudflare must ask you to sign in **before** Tandem appears. Verify that your allowed email works and a different, unlisted email cannot enter. If Tandem appears without the Access gate, fix the policy before proceeding.

Cloudflare Access login and Tandem pairing are separate checks; passing one does not replace the other. Keep the connector token private even with Access enabled.

#### Connect your phone and check the result

1. Wait for **Public access** to show **Tunnel connected for**, then open the HTTPS address on your phone (mobile data works).
2. Pass the Cloudflare Access login you verified above. In an already paired Tandem browser, open **Devices** and create a pairing link. Open that public-hostname link on your phone within five minutes; it works once. Never send a `127.0.0.1` or `localhost` link to the phone.
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
