import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ChangedFile, FilePatch, ProjectChanges } from "@tandem/contracts";
import { AlertCircleIcon, Columns2Icon, Rows2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChangeDiff } from "./change-diff.tsx";
import {
  ADDITIONS_COLOR,
  countParts,
  DELETIONS_COLOR,
  statusColor,
  statusLabel,
  statusLetter,
} from "./change-status.ts";

const DIFF_STYLE_KEY = "tandem.diffStyle";

/** A patch with the file it belongs to, so that another file's patch is never shown in its place. */
interface LoadedPatch {
  path: string;
  patch: FilePatch;
}

/**
 * The changes of a project against its integration branch, as Git reports them, and the selected file's patch. Both are
 * read again whenever the files on disk change, so an agent's edits arrive without asking.
 */
export function ChangesView({
  changes,
  failure,
}: {
  changes: ProjectChanges | undefined;
  /** Why the project's changes are not there, if opening them failed. */
  failure: string | null;
}) {
  const state = useReplicatedState(changes?.state);
  const [selected, setSelected] = useState<string | null>(null);
  const [styled, setStyled] = useState<"split" | "unified">(storedDiffStyle);
  const [loaded, setLoaded] = useState<LoadedPatch | null>(null);
  const [readFailure, setReadFailure] = useState<string | null>(null);

  // The selection follows the list: a file that leaves it takes the patch with it.
  useEffect(() => {
    if (selected !== null && state?.files.some((file) => file.path === selected) === true) return;
    setSelected(state?.files[0]?.path ?? null);
  }, [state, selected]);

  // Read the patch again for every published change of the file, and for every other selection.
  useEffect(() => {
    const file = state?.files.find((candidate) => candidate.path === selected);
    if (changes === undefined || file === undefined) return;
    let cancelled = false;
    setReadFailure(null);
    changes.diff(file.path, BACKGROUND_CONTEXT).then(
      (patch) => {
        if (!cancelled) setLoaded({ path: file.path, patch });
      },
      (error: unknown) => {
        if (!cancelled) setReadFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
    // The patch already read stays on screen while this one loads; one of another file is never shown, because
    // `loaded` carries its path.
  }, [changes, state, selected]);

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
      {state.message !== undefined && (
        <div className="p-2">
          <Alert variant={state.status === "ready" ? "default" : "destructive"}>
            <AlertCircleIcon />
            <AlertTitle>{titleOf(state.status)}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      )}
      <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
        {state.files.length === 0
          ? "No changed files"
          : `${state.files.length} changed ${state.files.length === 1 ? "file" : "files"}`}
        {state.base !== undefined && ` against ${state.base}`}
      </p>
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="changes" minSize={80} className="overflow-auto px-2 pb-2">
          <SidebarMenu aria-label="Changed files">
            {state.files.map((file) => (
              <SidebarMenuItem key={file.path}>
                <SidebarMenuButton
                  isActive={file.path === selected}
                  className="h-auto py-1 font-mono text-xs"
                  onClick={() => setSelected(file.path)}
                >
                  <span className={cn("w-3 shrink-0 font-sans font-medium", statusColor(file.status))}>
                    {statusLetter(file.status)}
                  </span>
                  <span className="truncate" title={statusLabel(file.status, file.from)}>
                    {file.path}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
                    {countParts(file.additions, file.deletions).map((part) => (
                      <span key={part.kind} className={part.kind === "additions" ? ADDITIONS_COLOR : DELETIONS_COLOR}>
                        {part.text}
                      </span>
                    ))}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </ResizablePanel>
        {selectedFile !== undefined && (
          <>
            <ResizableHandle />
            <ResizablePanel id="diff" defaultSize="70" minSize={120}>
              <ChangeView
                file={selectedFile}
                patch={loaded?.path === selectedFile.path ? loaded.patch : null}
                failure={readFailure}
                styled={styled}
                onStyled={setStyled}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function titleOf(status: "ready" | "notRepository" | "error"): string {
  if (status === "notRepository") return "Not a Git repository";
  return status === "error" ? "Cannot read the changes" : "Changes";
}

/** The selected file's patch, with the one control that changes how it is shown. */
function ChangeView({
  file,
  patch,
  failure,
  styled,
  onStyled,
}: {
  file: ChangedFile;
  patch: FilePatch | null;
  failure: string | null;
  styled: "split" | "unified";
  onStyled(style: "split" | "unified"): void;
}) {
  const next = styled === "split" ? "unified" : "split";
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Diff of ${file.path}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs" title={statusLabel(file.status, file.from)}>
          {file.path}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={next === "split" ? "Show the diff in two columns" : "Show the diff in one column"}
                onClick={() => {
                  localStorage.setItem(DIFF_STYLE_KEY, next);
                  onStyled(next);
                }}
              />
            }
          >
            {styled === "split" ? <Columns2Icon /> : <Rows2Icon />}
          </TooltipTrigger>
          <TooltipContent>{next === "split" ? "Two columns" : "One column"}</TooltipContent>
        </Tooltip>
      </header>
      <div className="min-h-0 flex-1">
        {failure !== null ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Cannot read the diff</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        ) : patch === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <Spinner />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : (
          <ChangeDiff path={file.path} patch={patch} style={styled} />
        )}
      </div>
    </section>
  );
}

function storedDiffStyle(): "split" | "unified" {
  return localStorage.getItem(DIFF_STYLE_KEY) === "unified" ? "unified" : "split";
}
