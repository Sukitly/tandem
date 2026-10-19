import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ProjectDirectory, Workspaces } from "@tandem/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { serviceKey } from "@/app/query-client.tsx";
import { errorMessage } from "@/lib/errors.ts";

type ProjectDirectoryRead =
  | { status: "loading" }
  | { status: "ready"; value: ProjectDirectory }
  | { status: "failed"; message: string };

export function useProjectDirectory(workspaces: Workspaces) {
  const [path, navigate] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["project-directory", serviceKey(workspaces), path],
    queryFn: async ({ signal }) => {
      const value = await workspaces.browse(path, BACKGROUND_CONTEXT);
      signal.throwIfAborted();
      return value;
    },
    staleTime: 0,
    gcTime: 0,
  });
  const listing: ProjectDirectoryRead = query.isFetching
    ? { status: "loading" }
    : query.isError
      ? { status: "failed", message: errorMessage(query.error) }
      : query.data === undefined
        ? { status: "loading" }
        : { status: "ready", value: query.data };
  return {
    listing,
    navigate,
    refresh: () => {
      void query.refetch();
    },
  };
}
