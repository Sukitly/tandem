import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ProjectDirectory, Workspaces } from "@tandem/contracts";
import { useEffect, useState } from "react";

export type ProjectDirectoryRead =
  | { status: "loading" }
  | { status: "ready"; value: ProjectDirectory }
  | { status: "failed"; message: string };

/** A one-shot filesystem snapshot, not a copy of the replicated project catalog. */
export function useProjectDirectory(workspaces: Workspaces) {
  const [target, setTarget] = useState<{ path: string | null }>({ path: null });
  const [listing, setListing] = useState<ProjectDirectoryRead>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    workspaces.browse(target.path, BACKGROUND_CONTEXT).then(
      (value) => {
        if (!cancelled) setListing({ status: "ready", value });
      },
      (failure: unknown) => {
        if (!cancelled) {
          setListing({ status: "failed", message: failure instanceof Error ? failure.message : String(failure) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaces, target]);

  const navigate = (path: string | null): void => {
    setListing({ status: "loading" });
    setTarget({ path });
  };

  return { listing, navigate, refresh: () => navigate(target.path) };
}
