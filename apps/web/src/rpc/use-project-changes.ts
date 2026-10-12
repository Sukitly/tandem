import type { ProjectChanges } from "@tandem/contracts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useConnected } from "./connection.tsx";

/** Keep a project's changes open while the calling component is mounted; `undefined` until its instance arrives. */
export function useProjectChanges(workspaceId: number): ProjectChanges | undefined {
  const { openChanges } = useConnected();
  useEffect(() => openChanges.hold(workspaceId), [openChanges, workspaceId]);
  const subscribe = useCallback((onChange: () => void) => openChanges.subscribe(onChange), [openChanges]);
  return useSyncExternalStore(subscribe, () => openChanges.get(workspaceId));
}
