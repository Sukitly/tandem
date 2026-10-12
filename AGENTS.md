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
- **Messages are untrusted Markdown**: the agent may repeat what a file or a web page told it. `untrustedMarkdown` (`src/chat/untrusted-markdown.ts`) shows raw HTML as text (line breaks excepted) and keeps only web, mail, and file links and web images. It replaces Streamdown's rehype-harden, which would turn `src/app.ts` into `/src/app.ts`; Streamdown's sanitizing and its confirmation before opening a web link stay on. File links (`src/app.ts#L12`, `src/app.ts:12`, or an absolute path inside the project; `src/files/file-link.ts`) open the file in the files panel. User messages are rendered as Markdown as well, so a place written in a message—a comment of the review—is a link that shows it; `remark-breaks` makes a single newline a line break, as a person writing in a message box expects. Math reads `$$…$$`, and `\(…\)` and `\[…\]` through `texDelimiters` (`src/chat/tex-delimiters.ts`); a single `$` stays a dollar sign.
- **The project panel** (`src/app/project-panel.tsx`) sits right of the conversation, with a tab per view of its project (shadcn `Tabs`, line variant); its header has no path, which the conversation header shows already. The Files tab (`src/files/`) shows a tree over the opened file, with each file's size. Tree icons come from the Symbols set (`@react-symbols/icons`) by file and folder name; the library's mapping pulls in every icon it ships, which adds about 170 KB gzip to the main bundle. The tree is built as shadcn's file tree block (`sidebar-11`): sidebar menu items, with collapsible directories, each listed when it first opens. As in the sidebar's project rows, an open or closed folder icon shows whether a directory is expanded; there is no arrow. Everything on disk is listed, hidden and ignored files included, as a developer expects; rows for hidden entries (a leading dot) and ones Git ignores are dimmed (`src/files/dimmed.ts`), and so is everything below them. Git decides what is ignored, through `git ls-files --others --ignored --exclude-standard --directory`, which reports an ignored directory as itself; a directory that is not in a repository marks nothing. What the panel shows of a project (listings, open directories, the opened file) lives in a `ProjectFiles` per project, kept by the workbench while the page is open; files are read when they open and on Refresh, and do not follow changes yet. Code is highlighted by the same Shiki as messages (`src/chat/highlight.tsx`), except files over 3,000 lines, which would hold up the page. Whether the panel is shown, and the panels' widths, are kept in `localStorage`.
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
- `Files` (`apps/server/src/services/files.ts`) lists directories and reads files of a project; entries carry their size and whether Git ignores them through the execution environment its agents use, so a sandbox later serves both. Paths are relative to the project; they are resolved with their symbolic links and must stay inside its directory. Files over 1 MB, and binary files (a NUL byte in the first 8,000 bytes, as Git judges), are not sent.
- `Changes` (`apps/server/src/services/changes.ts`) follows one project's changes while a client holds it open; asking Git is the other half, in `changes-git.ts` (`ChangeReader`). a client opens a project with `Changes.open`, receives a `ProjectChanges` instance with the list in its state, and lets it go with `Changes.close`. A project is tracked once however many clients watch it: `ChangeTrackers` counts holds and ends the tracker with the last one, and a hold is given up once, because the open that takes it and the close that gives it up arrive in either order. The tracker's own reads run under `BACKGROUND_CONTEXT`: a call's context is aborted when the call is done, and a read under an aborted context fails without saying so. A read keeps what it cannot change: whether the directory is a repository, which branch the list is measured against, and the line counts of untracked files whose size and modification time stand still, so a read is about five Git commands and no file is read twice for nothing. A manual refresh — and a watcher that reports uncertain coverage — forgets all of it and asks again. The list is measured against the merge base with the project's integration branch (`origin/HEAD`, else `main` or `master`), so branch commits, staged and unstaged work, and untracked files are one list; a project without an integration branch is compared with its last commit. The names of the changed files and their counts come from `git diff --name-status` and `--numstat`; untracked files come from `git ls-files --others`, with their added lines counted from the file. Everything runs through the project's execution environment, as `Files` does, in the project's directory with `--relative`, so a project that is a subdirectory of its repository still reports its own paths. Changes on disk come from `env.watch` with `.git` and `node_modules` excluded; events settle for 300 ms before the list is read again, an `overflow` reads everything again, and a watcher that stops leaves a message in the state and can be started again with `refresh`. `diff(path)` returns the patch against the same base (`--no-index` for an untracked file); a file Git cannot read is a `FilePatch` outcome with the message, not a rejection, since only a path the client may not ask about is its mistake.
- A project's changes are shown in the Changes tab of the panel beside the conversation (`src/changes/`), under a list of the changed files with each file's status letter, path, and counts (the row is a plain `SidebarMenuButton`, its parts styled inside it, as the file tree does); the selected file's patch is rendered by `@pierre/diffs` in a split view by default, with a switch to one column. The list and the patch are read again on every published change, so an agent's edits arrive without asking. A patch's item id carries its own text: without that, the renderer keeps the patch it drew before.
- Comments are threads on a line of a project's file, kept by the server (`Comments`, `apps/server/src/services/comments.ts`) in one session document and shared by every page, so a review survives a reload, another browser, and a restart. A thread belongs to the project, not to a conversation, since it is about the code. Its messages are the user's and, later, the agent's; a user's message that has not been sent waits, and the next message the user sends in the project carries every waiting one: the page sends their IDs with `submit`/`start`, and the server writes them into the message (`Comment #<id> on [path:line](path#Lline)`, the quoted line, then the note, or the thread so far for a reply) and marks them sent with the conversation and the request ID. Marking happens after the message is taken, as two commits, because pi-durable admits a message in its own commit; a send in flight holds its messages so that a second send cannot carry them too, and a refused message leaves them waiting. A sent message cannot be edited or taken back. A thread keeps its line's text and up to three lines on each side (`CommentAnchor`), because line numbers move as the agent edits: the page finds the line again by its text, where it was or else the copy whose neighbours match best, nearest the old number on a tie (`relocate`, `src/comments/comment-anchor.ts`); a line that is gone makes the thread outdated, shown above the file or the diff with the code it was written on. A diff shows only its hunks, so a line outside them is outdated there too. In a diff a comment is written by clicking a line's number, or the button beside the number of the line the pointer is on, which is ours and not the library's: the library's hover state belongs to the rendered item, and a comment arriving re-renders that item, which strands its button and its row highlight on the row they were on. The button follows the line the pointer is on, read from the diff's own numbering in its shadow root, and the whole row counts, not only the number column. A comment's row is given the diff's own background (`diff-plain-annotations.ts`); the rule has to be written inside the diff's shadow root, since nothing from outside reaches in. The renderer redraws an item only when its version changes, so the version is derived from the placed threads and the draft. The box a comment is written in is shadcn's input group, with the place and the buttons as its block addons, and a thread takes the same surface. A comment box ends at the right edge of the view it sits in rather than at the longest line's, which both a diff and an opened file would give it (`useCommentWidth`), since that runs past the panel and is cut off. Deleting a thread asks first.
- The panel's tab lives in the workbench (`src/app/workbench.tsx`), not in the panel, because showing a place has to switch the panel to the view that holds it: a comment of the review opens its file in the Changes tab, at its line, and a file that list does not hold—a comment on a file that did not change—opens in the Files tab instead. Scrolling to a line uses the code view's own scroll target: the diff is virtualized, so a line far from the viewport is not in the DOM to scroll to. A request is honoured once and then dropped, so later changes to the list do not pull the shown file back.
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
