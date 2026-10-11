import type { ReplicatedState } from "@earendil-works/chord";
import { useCallback, useSyncExternalStore } from "react";

/** The current value of a replicated state; `undefined` until it is hydrated. */
export function useReplicatedState<T>(state: ReplicatedState<T> | undefined): T | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => (state === undefined ? () => {} : state.subscribe(async () => onChange())),
    [state],
  );
  // Values are immutable and replaced on every update, so the value itself is a stable snapshot.
  return useSyncExternalStore(subscribe, () => state?.value);
}
