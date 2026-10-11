import type { Conversation } from "@tandem/contracts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useConnected } from "./connection.tsx";

/** Keep a conversation open while the calling component is mounted; `undefined` until its instance arrives. */
export function useConversation(id: number): Conversation | undefined {
  const { open } = useConnected();
  useEffect(() => open.hold(id), [open, id]);
  const subscribe = useCallback((onChange: () => void) => open.subscribe(onChange), [open]);
  return useSyncExternalStore(subscribe, () => open.get(id));
}
