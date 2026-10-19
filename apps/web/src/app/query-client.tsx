import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useDisposable } from "@/hooks/use-disposable.ts";

/** Snapshots only. Replicated state and remote service handles never enter this cache. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/** A new authenticated session receives a new cache; no data crosses connection ownership boundaries. */
export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => {
    const client = createQueryClient();
    return { client, dispose: () => client.clear() };
  });
  useDisposable(session);
  return <QueryClientProvider client={session.client}>{children}</QueryClientProvider>;
}

const identities = new WeakMap<object, number>();
let nextIdentity = 0;
/** Handles intercept property access. Key them by identity, never serialize or await them. */
export function serviceKey(service: object): number {
  let id = identities.get(service);
  if (id === undefined) {
    id = ++nextIdentity;
    identities.set(service, id);
  }
  return id;
}
