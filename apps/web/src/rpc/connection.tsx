import type { ConnectionStatus } from "@tandem/client";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PairScreen } from "@/auth/pair-screen.tsx";
import { ConnectionController, type ConnectionState, type Session } from "./connection-controller.ts";
import { useReplicatedState } from "./use-replicated-state.ts";

export type { ConnectionState } from "./connection-controller.ts";

/** What a component reaches the server with: the services, what this page has open, and how the connection is. */
export type Connected = Omit<Session, "connection"> & { status: ConnectionStatus | undefined };

const ConnectedContext = createContext<Connected | null>(null);

/** Connects once for the page, and renders `fallback` until the first connection succeeds. */
export function ConnectionProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: (state: Exclude<ConnectionState, { kind: "connected" }>) => ReactNode;
}) {
  const [controller] = useState(() => new ConnectionController({ onError: (error) => console.error(error) }));
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  if (state.kind !== "connected") return fallback(state);
  return <Opened session={state.session}>{children}</Opened>;
}

function Opened({ session, children }: { session: Session; children: ReactNode }) {
  const status = useReplicatedState(session.connection.status);
  const connected = useMemo<Connected>(() => {
    const { connection: _, ...rest } = session;
    return { ...rest, status };
  }, [session, status]);
  if (status?.status === "unauthorized") return <PairScreen />;
  return <ConnectedContext.Provider value={connected}>{children}</ConnectedContext.Provider>;
}

export function useConnected(): Connected {
  const connected = useContext(ConnectedContext);
  if (connected === null) throw new Error("useConnected() must be used inside ConnectionProvider");
  return connected;
}
