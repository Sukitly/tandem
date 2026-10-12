# Tandem

A local-first agent you work with, not hand tasks to.

Tandem runs on your own machine and lets you work with an agent on your Git repositories from the browser: steer it while it works, review its diffs, leave code comments for it, use a terminal, and preview the app you are building. Conversations are durable, so a page reload, a dropped connection, or a backend restart does not lose any work.

Tandem is built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable).

> **Status:** early scaffold. Nothing usable yet.

## Development

Requires [Bun](https://bun.com) for installing and running scripts, and [Node.js](https://nodejs.org) 22.19 or later for the backend. Terminals use [node-pty](https://github.com/microsoft/node-pty), a native module with prebuilt binaries for macOS, Linux (x64 and arm64), and Windows; on other platforms it builds on install and needs Python, `make`, and a C++ compiler.

```bash
bun install
bun run dev:server   # backend on http://127.0.0.1:4820
bun run dev:web      # web app on http://127.0.0.1:5173; proxies API calls to the backend
```

Open the URL the server prints: it carries the session token. Add a project, a directory on your machine, then start a conversation in it. Its files and its changes show in the panel on the right, as tabs; file links in the agent's answers open there, and the changes follow the files on disk as the agent edits them. Sign in to a model provider from **Model providers** in the sidebar; API keys in the server's environment (such as `ANTHROPIC_API_KEY`) work without signing in. To try the UI without any provider, start the server with `TANDEM_FAUX=1` for a local fake model that thinks, calls tools, and answers.

Data is kept in `~/.tandem`; set `TANDEM_HOME` to use another directory.

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
