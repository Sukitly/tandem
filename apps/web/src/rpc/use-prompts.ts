import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PromptTemplateSummary } from "@tandem/contracts";
import { skipToken, useQuery } from "@tanstack/react-query";
import { serviceKey } from "@/app/query-client.tsx";
import { useConnected } from "./connection.tsx";

const NONE: PromptTemplateSummary[] = [];

/** Optional filesystem suggestions. A failed refresh clears them rather than offering stale commands. */
export function usePrompts(workspaceId: number | undefined) {
  const { prompts } = useConnected();
  const query = useQuery({
    queryKey: ["prompts", serviceKey(prompts), workspaceId],
    queryFn: workspaceId === undefined ? skipToken : () => prompts.list(workspaceId, BACKGROUND_CONTEXT),
  });
  return {
    commands: query.isError ? NONE : (query.data ?? NONE),
    refresh: () => {
      if (workspaceId !== undefined) void query.refetch();
    },
  };
}
