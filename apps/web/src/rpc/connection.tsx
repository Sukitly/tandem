import { BootstrapError, type ConnectionStatus, connect, OpenConversations } from "@tandem/client";
import { Conversation, Conversations } from "@tandem/contracts";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { readToken } from "./token.ts";
import { useReplicatedState } from "./use-replicated-state.ts";

export interface Connected {
  /** The shared conversation list and its methods. */
  conversations: Conversations;
  /** The conversations this page has open. */
  open: OpenConversations;
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
      services: [Conversations, Conversation],
      onError: (error) => console.error(error),
    }).then(
      (connection) => {
        const open = new OpenConversations(connection, (error) => console.error(error));
        close = () => {
          open.dispose();
          void connection.close();
        };
        if (cancelled) close();
        // Wrapped: a service handle accepts any member name, `then` included, and must not resolve a promise.
        else
          setState({
            kind: "connected",
            value: { connection, open, conversations: connection.services.use(Conversations) },
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
    <ConnectedContext.Provider value={{ conversations: value.conversations, open: value.open, status }}>
      {children}
    </ConnectedContext.Provider>
  );
}

export function useConnected(): Connected {
  const connected = useContext(ConnectedContext);
  if (connected === null) throw new Error("useConnected() must be used inside ConnectionProvider");
  return connected;
}
