import type { OpenChanges } from "@tandem/client";
import type { ProjectChanges } from "@tandem/contracts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useConnected } from "./connection.tsx";

/** Keep a project's changes open while the calling component is mounted; `undefined` until its instance arrives. */
export function useProjectChanges(workspaceId: number, enabled = true): ProjectChanges | undefined {
  const { openChanges } = useConnected();
  useEffect(() => (enabled ? openChanges.hold(workspaceId) : undefined), [openChanges, workspaceId, enabled]);
  return useChangesStore((openChanges) => openChanges.get(workspaceId));
}

/** Why a project's changes are not there, if opening them failed. */
export function useProjectChangesFailure(workspaceId: number): string | null {
  return useChangesStore((openChanges) => openChanges.failure(workspaceId)) ?? null;
}

function useChangesStore<T>(read: (openChanges: OpenChanges) => T): T | undefined {
  const { openChanges } = useConnected();
  const subscribe = useCallback((onChange: () => void) => openChanges.subscribe(onChange), [openChanges]);
  return useSyncExternalStore(subscribe, () => read(openChanges));
}
