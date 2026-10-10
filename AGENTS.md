# AGENTS.md

Guidance for coding agents working in this repository. Humans should start with [README.md](README.md).

## Project overview

Tandem is a local-first agent product built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable). The first use case is interactive coding in the browser: the user works with an agent on Git repositories on their own machine, and conversations survive page reloads, disconnects, and backend restarts.

The code is the source of truth; there are no design documents in this repository. The rules below capture decisions that the code alone does not yet make obvious. The repository is currently a scaffold: the server only answers `/health` and the web app only shows its status.

## Repository layout

| Path | Package | Purpose |
|---|---|---|
| `apps/server` | `@tandem/server` | Backend process. Runs on Node; will host the pi-durable Harness, pi-server, and the workspace runtimes |
| `apps/web` | `@tandem/web` | React + Vite single-page app |
| `packages/contracts` | `@tandem/contracts` | Constants, types, and service contracts shared by server and clients |
| `packages/client` | `@tandem/client` | Connects to the server: bootstrap, pi-client over WebSocket, service bindings, reconnects. Used by the web app and by server integration tests |

Internal packages export TypeScript sources directly (`"exports": { ".": "./src/index.ts" }`); Node (type stripping) and Vite consume them without a build step. Reference them with `"workspace:*"`.

## Setup and commands

Bun is the package manager and script runner. Do not add npm, pnpm, or yarn lockfiles.

The backend runs on **Node >= 22.19**, not Bun: pi-durable's SQLite storage needs `node:sqlite`, which Bun cannot load. Node runs the TypeScript sources directly through type stripping. Do not use `Bun.*` APIs or `bun:*` modules in code.

| Task | Command |
|---|---|
| Install dependencies | `bun install` |
| Run the server in watch mode | `bun run dev:server` |
| Run the web app (proxies `/health`, `/rpc`, `/pty` to the server) | `bun run dev:web` |
| Lint and format check, then typecheck | `bun run check` |
| Apply formatting and safe lint fixes | `bunx biome check --write .` |
| Run all tests | `bun run test` |
| Build | `bun run build` |
| Run one package's script | `bun run --filter @tandem/server test` |
| Add a dependency to one package | `cd apps/web && bun add <name>` |

Before finishing a change, `bun run check` and `bun run test` must pass.

## Code style

- TypeScript in strict mode with `noUncheckedIndexedAccess`; shared options are in `tsconfig.base.json`.
- Biome formats and lints everything (`biome.json`): 2-space indentation, double quotes, semicolons, 120 columns, recommended rules, organized imports. Do not add ESLint or Prettier.
- ES modules only. Import local files with their `.ts` / `.tsx` extension, as Node's type stripping requires.
- Use `import type` for type-only imports (`verbatimModuleSyntax` is on). Only erasable TypeScript syntax: no `enum`, no `namespace`, no parameter properties.
- `packages/contracts` and `packages/client` must stay runtime-neutral: no Node or Bun imports. `packages/client` may use the `WebSocket` and `fetch` globals, which browsers and Node 22+ both provide.

## Language

All content in this repository is written in English: code, comments, identifiers, documentation, commit messages, and test names. Do not add text in any other language.

## Testing

- Tests use Vitest (running on Node) and live in each package's `test/` directory, named `*.test.ts`.
- Start servers on port `0` in tests and stop them in `afterEach`.
- Add or update tests for the behavior you change.

## Architecture rules

These are deliberate decisions. Do not break them without discussing it first:

- **One Harness.** The backend runs one pi-durable Harness over one SQLite database for every workspace. Workspaces are data, not processes or Sessions.
- **No pi-server Sessions.** Every service is served at pi-server's server scope, with one `RemoteServiceProvider` per client connection (`apps/server/src/rpc-host.ts`). Shared state, such as the conversation list, is one `ReplicatedState` object provided to every connection.
- **Per-connection instances, not global keyed services.** A Chord keyed subscription snapshot carries the state of every instance, so a global keyed service would send every conversation to every client. Clients call `open(id)` and the server spawns that instance on their connection only.
- **Clients render subscriptions.** UI state comes from replicated state the client subscribes to. Method results are only used to report errors. The client holds no authoritative state.
- **One execution path per workspace.** File access and process execution inside a workspace only go through its Workspace Runtime (ExecutionEnv, PtyHost, ProcessManager). No other module touches a repository directly.
- **Stop only stops the agent.** Aborting a conversation never kills terminals or managed processes.
- **Terminals are raw byte streams** on their own WebSocket; they do not go through Chord.
- **Upstream pi packages are experimental.** Pin their versions and keep calls into them in a small number of adapter modules.

## Security

- The server binds to `127.0.0.1` only. Do not change the default host.
- There is no sandbox yet: the agent runs with the user's permissions. Do not describe the product as isolated.
- Model credentials stay in the backend and are never sent to clients.
- WebSocket endpoints must check the session token and the `Origin` header once they exist.

## Upstream references

Tandem builds on the [earendil-works/pi](https://github.com/earendil-works/pi) monorepo. Useful sources:

- `packages/durable`: Harness, conversations, tasks, documents, tools, storage. `README.md` and `test/examples/` show every feature.
- `packages/server`, `packages/protocol`, `packages/client`: routing, wire protocol, and client.
- `packages/chord`: services, replicated state, facets.
- `packages/coding-agent/src/experimental/`: upstream's experimental server, durable TUI, and service contracts (`AgentController`, `Transcript`).
