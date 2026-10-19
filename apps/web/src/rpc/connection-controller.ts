import type { Service } from "@earendil-works/chord";
import {
  BootstrapError,
  connect,
  OpenChanges,
  OpenConversations,
  onConnectionWake,
  type TandemConnection,
} from "@tandem/client";
import {
  Changes,
  Comments,
  Conversation,
  Conversations,
  Devices,
  Files,
  Models,
  Preview,
  ProjectChanges,
  Prompts,
  PublicAccess,
  Repository,
  Terminals,
  Usage,
  Workspaces,
} from "@tandem/contracts";
import { errorMessage } from "@/lib/errors.ts";

/** The services components use, by the name each is known by. A connection binds these and nothing else. */
const SERVICES = {
  devices: Devices,
  /** Publishing this machine on the public internet, and what the tunnel is doing. */
  publicAccess: PublicAccess,
  /** The shared project list and its methods. */
  workspaces: Workspaces,
  /** The shared conversation list and its methods. */
  conversations: Conversations,
  /** Providers, sign-in, and available models. */
  models: Models,
  /** The projects' files. */
  files: Files,
  /** The comment threads of every project. */
  comments: Comments,
  /** Application preview ports. */
  preview: Preview,
  /** The prompt templates of the projects: the slash commands their messages may name. */
  prompts: Prompts,
  /** The terminals of every project. */
  terminals: Terminals,
  /** The providers' rate-limit usage, read by the server. */
  usage: Usage,
  /** The projects' pull requests, read by the server with `gh`. */
  repository: Repository,
} as const;

/** What `OpenConversations` and `OpenChanges` open one of per conversation and per project, not used by name. */
const OPENED_SERVICES = [Conversation, Changes, ProjectChanges] as const;

export type ServiceHandles = {
  [Name in keyof typeof SERVICES]: (typeof SERVICES)[Name] extends Service<infer Handle> ? Handle : never;
};

/** A connection that is open, and what a page reaches the server with through it. */
export interface Session extends ServiceHandles {
  connection: TandemConnection;
  deviceId?: string | undefined;
  /** The conversations this page has open. */
  open: OpenConversations;
  /** The projects whose changes this page shows. */
  openChanges: OpenChanges;
  /** Connect to a terminal with the paired browser's cookie. */
  openTerminal: TandemConnection["terminal"];
  /** A same-origin transcript image URL, authenticated by the browser's cookie. */
  imageUrl: TandemConnection["imageUrl"];
}

export type ConnectionState =
  | { kind: "connecting" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string; retry: () => void }
  | { kind: "connected"; session: Session };

export interface ConnectionControllerOptions {
  /** Where the server is; the page's own origin by default. */
  baseUrl?: string;
  /** How long after a failure to try again; the person can try at once with `retry`. */
  retryMs?: number;
  /** Replaced by tests. */
  connect?: typeof connect;
  onWake?: typeof onConnectionWake;
  onError?: (error: Error) => void;
}

/** One start of the controller, which ends with its stop. */
interface Run {
  cancelled: boolean;
  /** `failed` is also where it starts, since only a failed connection is tried again. */
  phase: "connecting" | "failed" | "connected" | "unauthorized";
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
  stopWake: () => void;
  close: () => void;
}

/**
 * Opens the page's connection, and opens it again while it cannot be reached: after a failure, at an interval, and
 * when the page comes back to the foreground or the network returns. A connection that is open reconnects by itself,
 * so this concerns only the first one. A 401 is not retried: the device has to be paired.
 *
 * It holds the state a page renders from, and can be started again after it is stopped.
 */
export class ConnectionController {
  readonly #options: ConnectionControllerOptions;
  readonly #listeners = new Set<() => void>();
  #state: ConnectionState = { kind: "connecting" };
  #run: Run | undefined;

  constructor(options: ConnectionControllerOptions = {}) {
    this.#options = options;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getState = (): ConnectionState => this.#state;

  start(): void {
    if (this.#run !== undefined) return;
    const run: Run = {
      cancelled: false,
      phase: "failed",
      abort: new AbortController(),
      timer: undefined,
      stopWake: () => {},
      close: () => {},
    };
    this.#run = run;
    run.stopWake = (this.#options.onWake ?? onConnectionWake)(() => this.#attempt(run));
    this.#attempt(run);
  }

  /** Closes the connection, cancels what is pending, and leaves it ready to start again. */
  stop(): void {
    const run = this.#run;
    if (run === undefined) return;
    this.#run = undefined;
    run.cancelled = true;
    run.abort.abort();
    clearTimeout(run.timer);
    run.stopWake();
    run.close();
    this.#set({ kind: "connecting" });
  }

  #set(state: ConnectionState): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }

  #attempt(run: Run): void {
    if (run.cancelled || run.phase !== "failed") return;
    run.phase = "connecting";
    clearTimeout(run.timer);
    this.#set({ kind: "connecting" });
    const onError = this.#options.onError ?? (() => {});
    (this.#options.connect ?? connect)({
      baseUrl: this.#options.baseUrl ?? window.location.origin,
      signal: run.abort.signal,
      services: [...Object.values(SERVICES), ...OPENED_SERVICES],
      onError,
    }).then(
      (connection) => {
        const open = new OpenConversations(connection, onError);
        const openChanges = new OpenChanges(connection, onError);
        run.close = () => {
          open.dispose();
          openChanges.dispose();
          void connection.close();
        };
        if (run.cancelled) return run.close();
        run.phase = "connected";
        this.#set({ kind: "connected", session: sessionOf(connection, open, openChanges) });
      },
      (error: unknown) => {
        if (run.cancelled) return;
        if (error instanceof BootstrapError && error.status === 401) {
          run.phase = "unauthorized";
          this.#set({ kind: "unauthorized" });
          return;
        }
        run.phase = "failed";
        this.#set({ kind: "failed", message: errorMessage(error), retry: () => this.#attempt(run) });
        run.timer = setTimeout(() => this.#attempt(run), this.#options.retryMs ?? 5_000);
      },
    );
  }
}

/**
 * Every service of `SERVICES` bound to `connection`, each under its name. `Object.entries` forgets that a name goes
 * with its own service's handle, which `ServiceHandles` says, so the object is built untyped and stated as that.
 */
function bindServices(connection: TandemConnection): ServiceHandles {
  // A handle intercepts every property access, so each is kept in an object and never resolved on its own.
  const handles: Record<string, unknown> = {};
  for (const [name, service] of Object.entries(SERVICES)) {
    handles[name] = connection.services.use(service as Service<unknown>);
  }
  return handles as ServiceHandles;
}

function sessionOf(connection: TandemConnection, open: OpenConversations, openChanges: OpenChanges): Session {
  return {
    ...bindServices(connection),
    connection,
    deviceId: connection.deviceId,
    open,
    openChanges,
    openTerminal: (id, screen, options) => connection.terminal(id, screen, options),
    imageUrl: (ref) => connection.imageUrl(ref),
  };
}
