import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ChangesState, ProjectChanges } from "@tandem/contracts";
import { skipToken, useQuery } from "@tanstack/react-query";
import { serviceKey } from "@/app/query-client.tsx";

/** A patch is a snapshot keyed by the published revision, not a replacement for the replicated file catalog. */
export function useChangePatch(
  changes: ProjectChanges | undefined,
  state: ChangesState | undefined,
  path: string | null,
) {
  const present = state?.status === "ready" && state.files.some((file) => file.path === path);
  const owner = changes === undefined ? null : serviceKey(changes);
  return useQuery({
    queryKey: ["patch", owner, path, state === undefined ? null : serviceKey(state)],
    queryFn:
      changes !== undefined && path !== null && present ? () => changes.diff(path, BACKGROUND_CONTEXT) : skipToken,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === owner && query?.queryKey[2] === path ? previous : undefined,
    gcTime: 0,
    staleTime: Infinity,
  });
}
