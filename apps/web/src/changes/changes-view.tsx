import type { ProjectChanges } from "@tandem/contracts";
import { AlertCircleIcon } from "lucide-react";
import { usePanelNavigation, useWorkbench } from "@/app/workbench.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { Reader } from "@/components/reader.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errors.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import type { ChangeTarget } from "./change-target.ts";
import { ChangeView } from "./change-view.tsx";
import { ChangedFilesList } from "./changed-files-list.tsx";
import { useChangePatch } from "./use-change-patch.ts";
import { useChangeSelection } from "./use-change-selection.ts";

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
  const { openFile } = usePanelNavigation();
  const { forgetChangeTarget } = useWorkbench((state) => ({ forgetChangeTarget: state.forgetChangeTarget }));
  const state = useReplicatedState(changes?.state);
  const { selected, select, revealed, reading } = useChangeSelection(state, reveal, {
    openFile,
    settle: forgetChangeTarget,
  });
  const patch = useChangePatch(changes, state, selected);

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
          <ChangedFilesList state={state} selected={selected} onSelect={select} />
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
                  onClose={() => select(null)}
                />
              </Reader>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
