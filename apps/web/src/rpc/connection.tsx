import { BootstrapError, type ConnectionStatus, connect, OpenChanges, OpenConversations } from "@tandem/client";
import {
  Changes,
  Comments,
  Conversation,
  Conversations,
  Files,
  Models,
  ProjectChanges,
  Terminals,
  Workspaces,
} from "@tandem/contracts";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { readToken } from "./token.ts";
import { useReplicatedState } from "./use-replicated-state.ts";

export interface Connected {
  /** The shared project list and its methods. */
  workspaces: Workspaces;
  /** The shared conversation list and its methods. */
  conversations: Conversations;
  /** Providers, sign-in, and available models. */
  models: Models;
  /** The projects' files. */
  files: Files;
  /** The comment threads of every project. */
  comments: Comments;
  /** The terminals of every project. */
  terminals: Terminals;
  /** The conversations this page has open. */
  open: OpenConversations;
  /** The projects whose changes this page shows. */
  openChanges: OpenChanges;
  status: ConnectionStatus | undefined;
}

type ConnectionState =
  | { kind: "connecting" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string }
  | { kind: "connected"; value: Omit<Connected, "status"> & { connection: Awaited<ReturnType<typeof connect>> } };

const ConnectedContext = createContext<Connected | null>(null);

/** Connects once for the page, and renders `fallback` until the first connection succeeds. */
export function ConnectionProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: (state: Exclude<ConnectionState, { kind: "connected" }>) => ReactNode;
}) {
  const [state, setState] = useState<ConnectionState>({ kind: "connecting" });

  useEffect(() => {
    const token = readToken();
    if (token === undefined) {
      setState({ kind: "unauthorized" });
      return;
    }
    let cancelled = false;
    let close = (): void => {};
    connect({
      baseUrl: window.location.origin,
      token,
      services: [Models, Workspaces, Files, Changes, ProjectChanges, Comments, Terminals, Conversations, Conversation],
      onError: (error) => console.error(error),
    }).then(
      (connection) => {
        const open = new OpenConversations(connection, (error) => console.error(error));
        const openChanges = new OpenChanges(connection, (error) => console.error(error));
        close = () => {
          open.dispose();
          openChanges.dispose();
          void connection.close();
        };
        if (cancelled) close();
        // Wrapped: a service handle accepts any member name, `then` included, and must not resolve a promise.
        else
          setState({
            kind: "connected",
            value: {
              connection,
              open,
              openChanges,
              workspaces: connection.services.use(Workspaces),
              conversations: connection.services.use(Conversations),
              models: connection.services.use(Models),
              files: connection.services.use(Files),
              comments: connection.services.use(Comments),
              terminals: connection.services.use(Terminals),
            },
          });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof BootstrapError && error.status === 401) setState({ kind: "unauthorized" });
        else setState({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
      close();
    };
  }, []);

  if (state.kind !== "connected") return fallback(state);
  return <Connected value={state.value}>{children}</Connected>;
}

function Connected({
  value,
  children,
}: {
  value: Extract<ConnectionState, { kind: "connected" }>["value"];
  children: ReactNode;
}) {
  const status = useReplicatedState(value.connection.status);
  return (
    <ConnectedContext.Provider
      value={{
        workspaces: value.workspaces,
        conversations: value.conversations,
        models: value.models,
        files: value.files,
        comments: value.comments,
        terminals: value.terminals,
        open: value.open,
        openChanges: value.openChanges,
        status,
      }}
    >
      {children}
    </ConnectedContext.Provider>
  );
}

export function useConnected(): Connected {
  const connected = useContext(ConnectedContext);
  if (connected === null) throw new Error("useConnected() must be used inside ConnectionProvider");
  return connected;
}
