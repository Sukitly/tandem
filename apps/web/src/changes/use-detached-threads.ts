import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { serviceKey } from "@/app/query-client.tsx";
import { indexLines, type PlacedThread, relocate } from "@/comments/comment-anchor.ts";
import { errorMessage } from "@/lib/errors.ts";
import { useConnected } from "@/rpc/connection.tsx";

/** Missing patch context never proves an anchor is outdated. Verify it against a separately owned snapshot. */
export function useDetachedThreads(
  workspaceId: number,
  path: string,
  patchText: string,
  placed: readonly PlacedThread[],
) {
  const { files } = useConnected();
  const missing = placed.filter((entry) => entry.line === undefined);
  const needsFile = missing.some(({ thread }) => thread.anchor.side !== "deletions");
  const revision = useMemo(() => ({ patchText }), [patchText]);
  const query = useQuery({
    queryKey: ["comment-location", serviceKey(files), workspaceId, path, serviceKey(revision)],
    enabled: needsFile,
    gcTime: 0,
    queryFn: async () => {
      const content = await files.read({ workspaceId, path }, BACKGROUND_CONTEXT);
      if (content.kind !== "text")
        throw new Error(content.kind === "binary" ? "The file is not text." : "The file is too large to verify.");
      return (content.text.endsWith("\n") ? content.text.slice(0, -1) : content.text).split("\n");
    },
  });
  const lines = query.data;
  const index = useMemo(
    () => (lines === undefined ? new Map<string, number[]>() : indexLines((line) => lines[line - 1], lines.length)),
    [lines],
  );
  const threads: (PlacedThread & { reason: "outdated" | "outside" | "unverified" })[] = missing.map(({ thread }) => {
    // We have no old-file snapshot with which to verify a deletion-side anchor.
    if (thread.anchor.side === "deletions" || lines === undefined)
      return { thread, line: undefined, reason: "unverified" };
    const line = relocate(thread.anchor, (line) => lines[line - 1], lines.length, index.get(thread.anchor.quote) ?? []);
    return { thread, line, reason: line === undefined ? "outdated" : "outside" };
  });
  return {
    threads,
    pending: needsFile && query.isPending,
    failure: needsFile && query.isError ? errorMessage(query.error) : null,
    retry: () => {
      void query.refetch();
    },
  };
}
