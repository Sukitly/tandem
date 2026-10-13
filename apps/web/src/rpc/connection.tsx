import {
  BootstrapError,
  type ConnectionStatus,
  connect,
  OpenChanges,
  OpenConversations,
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
  ProjectChanges,
  Prompts,
  PublicAccess,
  Terminals,
  Workspaces,
} from "@tandem/contracts";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { PairScreen } from "@/auth/pair-screen.tsx";
import { clearLegacyToken } from "./token.ts";
import { useReplicatedState } from "./use-replicated-state.ts";

export interface Connected {
  devices: Devices;
  /** Publishing this machine on the public internet, and what the tunnel is doing. */
  publicAccess: PublicAccess;
  deviceId?: string;
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
  /** The prompt templates of the projects: the slash commands their messages may name. */
  prompts: Prompts;
  /** The terminals of every project. */
  terminals: Terminals;
  /** Connect to a terminal with the paired browser's cookie. */
  openTerminal: TandemConnection["terminal"];
  /** A same-origin transcript image URL, authenticated by the browser's cookie. */
  imageUrl: TandemConnection["imageUrl"];
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
    clearLegacyToken();
    let cancelled = false;
    let close = (): void => {};
    connect({
      baseUrl: window.location.origin,
      services: [
        Models,
        Devices,
        Workspaces,
        Files,
        Changes,
        ProjectChanges,
        Comments,
        Terminals,
        Prompts,
        Conversations,
        Conversation,
      ],
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
              devices: connection.services.use(Devices),
              publicAccess: connection.services.use(PublicAccess),
              deviceId: connection.deviceId,
              open,
              openChanges,
              workspaces: connection.services.use(Workspaces),
              conversations: connection.services.use(Conversations),
              models: connection.services.use(Models),
              files: connection.services.use(Files),
              comments: connection.services.use(Comments),
              prompts: connection.services.use(Prompts),
              terminals: connection.services.use(Terminals),
              openTerminal: (id, screen, options) => connection.terminal(id, screen, options),
              imageUrl: (ref) => connection.imageUrl(ref),
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
  if (status?.status === "unauthorized") return <PairScreen />;
  return (
    <ConnectedContext.Provider
      value={{
        devices: value.devices,
        publicAccess: value.publicAccess,
        deviceId: value.deviceId,
        workspaces: value.workspaces,
        conversations: value.conversations,
        models: value.models,
        files: value.files,
        comments: value.comments,
        prompts: value.prompts,
        terminals: value.terminals,
        openTerminal: value.openTerminal,
        imageUrl: value.imageUrl,
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
