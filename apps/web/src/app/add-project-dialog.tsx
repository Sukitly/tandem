import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ProjectDirectory } from "@tandem/contracts";
import { ArrowUp, Folder, House, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useConnected } from "@/rpc/connection.tsx";
import { useProjectDirectory } from "@/rpc/use-project-directory.ts";

/** Chooses a directory on the server's machine without uploading its files. */
export function AddProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AddProjectContent onAdded={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function AddProjectContent({ onAdded }: { onAdded: () => void }) {
  const { workspaces } = useConnected();
  const { listing, navigate, refresh } = useProjectDirectory(workspaces);
  const directory = listing.status === "ready" ? listing.value : null;
  const loading = listing.status === "loading";
  const [addError, setAddError] = useState<string | null>(null);
  const error = addError ?? (listing.status === "failed" ? listing.message : null);
  const [adding, setAdding] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (directory === null || loading || adding) return;
    setAdding(true);
    setAddError(null);
    workspaces.add({ path: directory.path }, BACKGROUND_CONTEXT).then(
      () => {
        if (mounted.current) onAdded();
      },
      (failure: unknown) => {
        if (!mounted.current) return;
        setAddError(errorMessage(failure));
        setAdding(false);
      },
    );
  };

  return (
    <DialogContent>
      <form onSubmit={submit} className="grid min-w-0 gap-4">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            Choose a directory on the machine Tandem runs on. Its conversations work in it.
          </DialogDescription>
        </DialogHeader>
        <ProjectDirectoryPicker
          directory={directory}
          busy={loading || adding}
          onNavigate={(path) => {
            setAddError(null);
            navigate(path);
          }}
        />
        {loading && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading directories…
          </div>
        )}
        {error !== null && (
          <Alert variant="destructive">
            <AlertTitle>Cannot complete the action</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={loading || adding}
            onClick={() => {
              setAddError(null);
              refresh();
            }}
          >
            <RefreshCw /> {error === null ? "Refresh" : "Retry"}
          </Button>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={loading || adding || directory === null}>
            {adding && <Spinner />} Add project
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** The current directory is selected; opening a child selects that directory instead. */
export function ProjectDirectoryPicker({
  directory,
  busy,
  onNavigate,
}: {
  directory: ProjectDirectory | null;
  busy: boolean;
  onNavigate: (path: string | null) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Home directory"
          disabled={busy}
          onClick={() => onNavigate(null)}
        >
          <House />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Parent directory"
          disabled={busy || directory?.parent == null}
          onClick={() => directory !== null && onNavigate(directory.parent)}
        >
          <ArrowUp />
        </Button>
        <div className="min-w-0 break-all text-sm" role="status" aria-label="Selected directory">
          {directory?.path ?? "Choose a directory"}
        </div>
      </div>
      <section className="h-64 overflow-y-auto rounded-lg border p-1" aria-label="Directories" aria-busy={busy}>
        {directory?.directories.map((entry) => (
          <Button
            key={entry.path}
            type="button"
            variant="ghost"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => onNavigate(entry.path)}
          >
            <Folder className="shrink-0" /> <span className="truncate">{entry.name}</span>
          </Button>
        ))}
        {directory?.directories.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No subdirectories</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
