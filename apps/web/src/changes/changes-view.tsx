import type { ProjectChanges } from "@tandem/contracts";
import { AlertCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/app/query-client.tsx";
import { useWorkbench } from "@/app/workbench.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { Reader } from "@/components/reader.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import type { DiffReadingState } from "./change-diff.tsx";
import type { ChangeTarget } from "./change-target.ts";
import { ChangeView } from "./change-view.tsx";
import { ChangedFilesList } from "./changed-files-list.tsx";
import { useChangePatch } from "./use-change-patch.ts";

/**
 * The changes of a project against its integration branch, as Git reports them, and the selected file's patch.
 */
export function ChangesView({
  active = true,
  changes,
  failure,
  comments,
  reveal,
}: {
  active?: boolean;
  changes: ProjectChanges | undefined;
  /** Why the project's changes are not there, if opening them failed. */
  failure: string | null;
  /** The project's comment threads, shown on the lines they are about. */
  comments: ProjectComments;
  /** A place asked for—a comment of the review—to show as soon as the list holds its file. */
  reveal?: ChangeTarget;
}) {
  const { openFile, forgetChangeTarget } = useWorkbench((state) => ({
    openFile: state.openFile,
    forgetChangeTarget: state.forgetChangeTarget,
  }));
  const state = useReplicatedState(changes?.state);
  const [selected, setSelected] = useState<string | null>(() => state?.files[0]?.path ?? null);
  const initialized = useRef(selected !== null);
  const [reading] = useState<DiffReadingState>(() => ({ positions: new Map(), revealed: new WeakSet() }));
  const [revealed, setRevealed] = useState<ChangeTarget | null>(null);
  const patch = useChangePatch(changes, state, selected);

  useEffect(() => {
    if (reveal === undefined || state === undefined) return;
    if (state.status === "ready" && state.files.some((file) => file.path === reveal.path)) {
      setSelected(reveal.path);
      setRevealed(reveal);
      initialized.current = true;
    } else {
      openFile(reveal.path, {
        ...(reveal.line === undefined ? {} : { line: reveal.line }),
        ...(reveal.threadId === undefined ? {} : { threadId: reveal.threadId }),
      });
    }
    forgetChangeTarget();
  }, [reveal, state, openFile, forgetChangeTarget]);

  useEffect(() => {
    if (state?.status !== "ready") return;
    for (const path of reading.positions.keys()) {
      if (!state.files.some((file) => file.path === path)) reading.positions.delete(path);
    }
    if (!initialized.current && state.files.length > 0) {
      initialized.current = true;
      setSelected(state.files[0]?.path ?? null);
      return;
    }
    setSelected((current) =>
      current !== null && state?.files.some((file) => file.path === current) === true ? current : null,
    );
  }, [state, reading]);

  if (failure !== null) {
    return (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Cannot read the changes</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (state === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    );
  }

  const selectedFile = state.files.find((file) => file.path === selected);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="changes" minSize={80} className="overflow-auto px-2 pb-2">
          <ChangedFilesList state={state} selected={selected} onSelect={setSelected} />
        </ResizablePanel>
        {selectedFile !== undefined && (
          <>
            <ResizableHandle />
            <ResizablePanel id="diff" defaultSize="70" minSize={120}>
              <Reader active={active} label={`Diff of ${selectedFile.path}`}>
                <ChangeView
                  reading={reading}
                  file={selectedFile}
                  reveal={revealed ?? undefined}
                  patch={patch.data ?? null}
                  failure={patch.isError ? errorMessage(patch.error) : null}
                  comments={comments}
                  onClose={() => setSelected(null)}
                />
              </Reader>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
