# AGENTS.md

Guidance for coding agents working in this repository. Humans should start with [README.md](README.md).

## Project overview

Tandem is a local-first agent product built on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable). The first use case is interactive coding in the browser: the user works with an agent on Git repositories on their own machine, and conversations survive page reloads, disconnects, and backend restarts.

The code is the source of truth; there are no design documents in this repository. The rules below capture decisions that the code alone does not yet make obvious. The project is early: the server serves projects and their conversations over WebSocket with real model providers, and the web app lists them and chats in them.

## Repository layout

| Path | Package | Purpose |
|---|---|---|
| `apps/server` | `@tandem/server` | Backend process. Runs on Node; hosts the pi-durable Harness and pi-server, and later the workspace runtimes |
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
| Run the server in watch mode; allows the web app's origin and prints the URL to open | `bun run dev:server` |
| Run the web app on port 5173 (proxies the server's paths) | `bun run dev:web` |
| Lint and format check, then typecheck | `bun run check` |
| Apply formatting and safe lint fixes | `bunx biome check --write .` |
| Run all tests | `bun run test` |
| Build | `bun run build` |
| Run one package's script | `bun run --filter @tandem/server test` |
| Add a dependency to one package | `cd apps/web && bun add <name>` |

Before finishing a change, `bun run check` and `bun run test` must pass.

## State directory

The server keeps its data in `$TANDEM_HOME`, default `~/.tandem` (`apps/server/src/state-dir.ts`):

| File | Content |
|---|---|
| `app.sqlite` | The Harness database: every conversation of every workspace, and the workspace list |
| `server.json` | Server identity and session token, mode `0600`. Kept across restarts so that open pages reconnect by themselves |
| `server.lock` | Held while a server runs: pi-durable allows one process per database |
| `auth.json` | Model credentials (OAuth tokens, API keys), mode `0600`. Never sent to clients. Tandem does not share pi's `~/.pi/agent/auth.json`: OAuth refresh tokens rotate, so sharing one would sign the other program out |
| `settings.json` | Preferences such as the default model, and the installation's device ID |

## Code style

- TypeScript in strict mode with `noUncheckedIndexedAccess`; shared options are in `tsconfig.base.json`.
- Biome formats and lints everything (`biome.json`): 2-space indentation, double quotes, semicolons, 120 columns, recommended rules, organized imports. Do not add ESLint or Prettier.
- ES modules only. Import local files with their `.ts` / `.tsx` extension, as Node's type stripping requires.
- Use `import type` for type-only imports (`verbatimModuleSyntax` is on). Only erasable TypeScript syntax: no `enum`, no `namespace`, no parameter properties.
- `packages/contracts` and `packages/client` must stay runtime-neutral: no Node or Bun imports. `packages/client` may use the `WebSocket` and `fetch` globals, which browsers and Node 22+ both provide.

## Web app

- The UI is shadcn/ui, style `base-nova` on Base UI (`apps/web/components.json`), initialized with `bunx --bun shadcn@latest init --preset b0 --template vite --pointer`. Add components with `bunx --bun shadcn@latest add <name>` from `apps/web`. Base UI composes with the `render` prop, not Radix's `asChild`; a link styled as a button is an `<a>` with `buttonVariants()`.
- **General controls come from shadcn/ui**: buttons, inputs, dialogs, menus, popovers, lists, alerts, empty states. Do not rebuild them from raw elements or restyle them; use their props and variants, and `className` for layout.
- **Chat components are Tandem's own**, in `src/chat/`: messages, thoughts, tool calls, the message box, and the status bar. They are built from shadcn/ui parts and Tailwind, and may style themselves. Markdown renders with Streamdown (`src/chat/markdown.tsx`), except fenced code: messages and tool output share `CodeBlock` (`src/chat/code-block.tsx`), highlighted by the Shiki of Streamdown's code plugin; the transcript scrolls with `use-stick-to-bottom`. Do not add AI Elements back: its tool and message components are built around the AI SDK's data, not pi's.
- **Messages are untrusted Markdown**: the agent may repeat what a file or a web page told it. `untrustedMarkdown` (`src/chat/untrusted-markdown.ts`) shows raw HTML as text (line breaks excepted) and keeps only web, mail, and file links and web images. It replaces Streamdown's rehype-harden, which would turn `src/app.ts` into `/src/app.ts`; Streamdown's sanitizing and its confirmation before opening a web link stay on. File links (`src/app.ts#L12`, `src/app.ts:12`, or an absolute path inside the project; `src/files/file-link.ts`) open the file in the files panel. Math reads `$$…$$`, and `\(…\)` and `\[…\]` through `texDelimiters` (`src/chat/tex-delimiters.ts`); a single `$` stays a dollar sign.
- **The files panel** (`src/files/`) sits right of the conversation and shows its project's files: a tree (`@headless-tree/react`, each directory listed when first expanded) over the opened file. Like the chat components, it is Tandem's own and styles itself. Everything on disk is listed, hidden and ignored files included, as a developer expects. Files are read when they open and on Refresh; they do not follow changes yet. Code is highlighted by the same Shiki as messages (`src/chat/highlight.tsx`), except files over 3,000 lines, which would hold up the page. Whether it is shown, and the panels' widths, are kept in `localStorage`.
- The theme follows the system, and the user can choose light or dark (`src/theme.tsx`; `index.html` applies it before the first paint). Every color comes from the theme's CSS variables or has a `dark:` variant.
- Text fields have no focus ring and keep their border when focused (`src/index.css`, by `data-slot`); invalid fields keep their red ring.
- `src/components/ui/` is generated. Compose and style it from the outside rather than editing it, so it can be updated. It is excluded from linting.
- `src/rpc/` connects to the server and exposes replicated state to React (`useReplicatedState`, `useConversation`). Components read state there and never keep their own copy of server state.
- A page opens conversations through `OpenConversations` (`packages/client`), which opens them again after a reconnect.

## Models

- Providers are pi-ai's built-in ones (`apps/server/src/models.ts`). API keys in the server's environment work without signing in.
- Logins run on the server (`apps/server/src/services/models.ts`): the browser shows the flow's events and answers its prompts through the `Models` service, and never receives a credential.
- `configureModelHttp()` (`apps/server/src/http-setup.ts`) must run before any model request, as pi's coding agent does; without it some providers' streams break off.
- `TANDEM_FAUX=1` adds a local faux model that needs no credentials. It runs a scripted turn (`demoResponse`): it thinks, lists the directory and reads the README, then answers, so every part of the transcript shows. Tests pass the faux provider only, never the built-in ones.
- The agent's system prompt is Tandem's own (`apps/server/src/prompt.ts`, extension `tandem.prompt`), in the shape of pi's coding agent, whose prompt code is internal: role, tools, rules, the project's `AGENTS.md` or `CLAUDE.md` from the working directory up to the root, and the working directory.

## Services

- Service contracts live in `packages/contracts`; implementations in `apps/server/src/services/`.
- Reject bad client input with `invalidInput()` (`apps/server/src/services/errors.ts`), which throws a Chord `RemoteServiceError`. pi-server forwards only service and server errors; any other error reaches the client as "Internal server error" and goes to the server's `onError`.
- Methods receive untrusted JSON. Validate every argument at runtime; the TypeScript types are not checked on the wire.
- Resources that outlive a call, such as view states and spawned instances, are created with `BACKGROUND_CONTEXT`, not with the call's context.
- Workspaces are called projects in the UI. The list is a Session document (`tandem.workspaces`, `apps/server/src/services/workspaces.ts`); each conversation records its workspace in `tandem.conversation` and works in the workspace's directory. Removing a workspace only marks it removed, so adding the directory again brings back its conversations.
- A conversation exists from its first message: `Conversations.start` creates it and submits that message in one call, with the model and thinking level chosen beforehand. Until then, a new conversation lives only in the web app (`NewChat`). Conversations from before this that never got a message have no title and stay out of the list.
- `Files` (`apps/server/src/services/files.ts`) lists directories and reads files of a project through the execution environment its agents use, so a sandbox later serves both. Paths are relative to the project; they are resolved with their symbolic links and must stay inside its directory. Files over 1 MB, and binary files (a NUL byte in the first 8,000 bytes, as Git judges), are not sent.
- The conversation list carries what the sidebar needs without opening a conversation: the last activity, and whether the agent is running, which comes from the Harness's task graph.
- Remote service handles accept any member name, including `then`. Never resolve a promise with a handle or `await` one: that calls `then` as a remote method. Wrap handles in an object instead.

## Language

All content in this repository is written in English: code, comments, identifiers, documentation, commit messages, and test names. Do not add text in any other language.

## Testing

- Tests use Vitest (running on Node) and live in each package's `test/` directory, named `*.test.ts`.
- Start servers on port `0` in tests and stop them in `afterEach`.
- Give every test server its own temporary state directory (`mkdtemp`). Never touch `~/.tandem` in tests.
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
- Every WebSocket endpoint checks the session token and the `Origin` header (`apps/server/src/server.ts`).

## Upstream references

Tandem builds on the [earendil-works/pi](https://github.com/earendil-works/pi) monorepo. Useful sources:

- `packages/durable`: Harness, conversations, tasks, documents, tools, storage. `README.md` and `test/examples/` show every feature.
- `packages/server`, `packages/protocol`, `packages/client`: routing, wire protocol, and client.
- `packages/chord`: services, replicated state, facets.
- `packages/coding-agent/src/experimental/`: upstream's experimental server, durable TUI, and service contracts (`AgentController`, `Transcript`).
