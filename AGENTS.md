# AGENTS.md

Guidance for AI coding agents working in this repository. Human contributors should start with [README.md](README.md).

## Project overview

Tandem is a local-first agent product built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable). It provides interactive coding in the browser on local Git repositories, with persistent conversations that survive page reloads, disconnects, and backend restarts.

The code is the source of truth; there are no separate design documents. All repository content (code, comments, documentation, commit messages, test names) must be written in English.

## Repository layout

| Path | Package | Purpose |
|---|---|---|
| `apps/server` | `@tandem/server` | Backend process (Node). Hosts the pi-durable Harness, pi-server RPC, and pseudo-terminals |
| `apps/web` | `@tandem/web` | Frontend single-page app (React + Vite + Tailwind + shadcn/ui) |
| `packages/contracts` | `@tandem/contracts` | Shared types, constants, and service interfaces (runtime-neutral) |
| `packages/client` | `@tandem/client` | Client connection library: bootstrap, RPC, service bindings, reconnects |

Internal packages export TypeScript sources directly (`workspace:*`) and are consumed without a build step.

## Setup & dev commands

- **Package manager:** Bun. Never add npm, pnpm, or yarn lockfiles.
- **Server runtime:** Node >= 22.19 (required for `node:sqlite`). Do not run the server on Bun or use `Bun.*` / `bun:*` APIs in server or package code.

### Commands reference

| Task | Command |
|---|---|
| Install dependencies | `bun install` |
| Start full development environment (backend + Vite) | `bun run dev` |
| Start backend in watch mode | `bun run dev:server` |
| Start web frontend | `bun run dev:web` |
| Build all packages | `bun run build` |
| Run lint and format check, then typecheck | `bun run check` |
| Apply formatting and safe lint fixes | `bunx biome check --write .` |
| Run all tests | `bun run test` |
| Run tests for a single package | `bun run --filter <package> test` |
| Add a dependency to a package | `cd <package-dir> && bun add <name>` |
| Manage background service | `bun run service [install\|pair\|restart]` |
| Manage Cloudflare tunnel | `bun run tunnel [create\|configure\|setup]` |

### Pre-completion check

Always run and pass `bun run check` and `bun run test` before finishing any task.

## Code style & conventions

- **TypeScript:** Strict mode enabled with `noUncheckedIndexedAccess`.
- **Formatting and linting:** Handled by Biome (`biome.json`). 2-space indentation, double quotes, semicolons, 120-column line limit. Do not add ESLint or Prettier.
- **Module imports:** ES modules only. Local imports must include explicit `.ts` / `.tsx` extensions for Node type stripping.
- **Type imports:** Use `import type` (`verbatimModuleSyntax` is enabled).
- **TypeScript syntax:** Only erasable syntax is permitted. Do not use `enum`, `namespace`, or parameter properties.
- **Runtime neutrality:** `packages/contracts` and `packages/client` must remain runtime-neutral (no Node or Bun APIs; use standard Web APIs such as `WebSocket` and `fetch`).

## State directory (`$TANDEM_HOME`, default `~/.tandem`)

| File / Dir | Content & Permissions |
|---|---|
| `app.sqlite` | Harness database: all workspaces, conversations, and documents |
| `server.json` | Server identity and local installation master key (mode `0600`) |
| `devices.json` | Paired-device metadata, session hashes, and recovery hashes (mode `0600`) |
| `server.lock` | Exclusive process lock held while a server runs |
| `auth.json` | Model credentials (OAuth tokens, API keys, mode `0600`). Never sent to clients |
| `settings.json` | Settings (default model, thinking level, public URL, device ID) |

## Testing instructions

- **Runner:** Vitest on Node. Tests live in `test/` within each package and end in `*.test.ts`.
- **Ephemeral resources:** Always start servers on port `0` and close them in `afterEach`.
- **State directory isolation:** Tests must allocate a temporary directory (`mkdtemp`) for `$TANDEM_HOME`. Never touch `~/.tandem` in tests.
- **Mock model:** Set `TANDEM_FAUX=1` to run deterministic scripted turns without model credentials.
- **Coverage:** Add or update tests for any changed behavior.

## Web app guidelines (`apps/web`)

- **Component library:** shadcn/ui (`base-nova` preset on Base UI). Add components with `bunx --bun shadcn@latest add <name>`.
- **Base UI composition:** Compose using the `render` prop (not Radix `asChild`).
- **UI separation:** General controls (buttons, inputs, dialogs, menus) come from shadcn/ui. Chat components in `src/chat/` are custom Tandem components.
- **Generated code:** Do not edit `src/components/ui/` directly; compose and style components from the outside.
- **Replicated state:** UI state in `src/rpc/` uses `useReplicatedState` and `useConversation`. Components render subscriptions and must not store local copies of replicated server state. Snapshot reads (e.g. file trees) are display-only.
- **Untrusted Markdown:** Agent and user messages are untrusted Markdown. Always sanitize via `untrustedMarkdown` (`src/chat/untrusted-markdown.ts`).
- **Theming:** Support light and dark modes via theme CSS variables or Tailwind `dark:` variants.

## Architecture & deliberate decisions

- **One Harness:** The server runs a single `pi-durable` Harness over SQLite. Workspaces are data, not separate processes or sessions.
- **No pi-server Sessions:** Services run at server scope with one `RemoteServiceProvider` per client connection (`apps/server/src/rpc-host.ts`). Clients call `open(id)` to spawn per-connection instances.
- **Clients render subscriptions:** Authoritative state comes strictly from replicated state subscriptions. Mutation results must not replace subscriptions.
- **Workspace execution boundary:** All workspace file operations and process execution must go through the Workspace Runtime (`ExecutionEnv`).
- **Agent lifecycle:** Aborting a conversation stops only the agent; it never terminates pseudo-terminals or managed processes.
- **Terminals:** Pseudo-terminals run over raw WebSocket endpoints (`/pty/<id>`), not Chord RPC.
- **Remote service handles:** Chord handles intercept any property access including `then`. Never `await` or resolve a promise with a remote handle directly; wrap handles in an object.
- **Runtime validation:** Remote service methods receive untrusted JSON. Validate all parameters at runtime; reject invalid data with `invalidInput()` (`RemoteServiceError`).
- **Background context:** Resources outliving an RPC call must use `BACKGROUND_CONTEXT`.
- **Model HTTP setup:** `configureModelHttp()` must be called before initiating model provider requests.
- **Image handling:** Message images are sanitized, resized in worker threads, and served via authenticated `/image/...` endpoints; image data is never embedded inline in conversation view state.

## Security guidelines

- **Network binding:** Server binds strictly to `127.0.0.1`. Do not change the default host.
- **Sandbox status:** There is currently no sandbox; the agent runs with the host user's permissions.
- **Credential isolation:** Model credentials in `auth.json` stay on the backend and are never sent to clients.
- **Authentication:**
  - Browser clients authenticate using per-device `HttpOnly`, `SameSite=Strict` cookies (and `Secure` on HTTPS).
  - Non-browser clients authenticate using `Authorization: Bearer <master-key>`.
  - Credentials must never appear in URL query parameters.
- **Origin & Host validation:** All HTTP, WebSocket, and RPC endpoints enforce strict `Origin` and `Host` checks against allowed local and configured public endpoints.
- **Web security headers:** Static files and HTML are served with CSP, nosniff, no-referrer, and same-origin CORP.
