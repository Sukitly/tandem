import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { FileIcon } from "@react-symbols/icons/utils";
import type { ChangedFile, FilePatch, ProjectChanges } from "@tandem/contracts";
import { AlertCircleIcon, Columns2Icon, Maximize2Icon, Minimize2Icon, Rows2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import { CopyPathButton } from "@/components/copy-path-button.tsx";
import { ReaderSurface, ReaderWrapButton } from "@/components/reader-surface.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { preferences } from "@/lib/preferences.ts";
import { cn } from "@/lib/utils";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChangeDiff, type DiffReadingState } from "./change-diff.tsx";
import {
  ADDITIONS_COLOR,
  type CountPart,
  countParts,
  DELETIONS_COLOR,
  statusColor,
  statusLabel,
  statusLetter,
} from "./change-status.ts";
import type { ChangeTarget } from "./change-target.ts";

const DIFF_STYLE_MOBILE_KEY = "tandem.diffStyle.mobile";
const DIFF_STYLE_KEY = "tandem.diffStyle";
const DIFF_STYLE_ZOOMED_KEY = "tandem.diffStyle.zoomed";
const DIFF_WRAP_KEY = "tandem.diffWrap";
const DIFF_WRAP_ZOOMED_KEY = "tandem.diffWrap.zoomed";

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
  const { openFile, forgetChangeTarget } = useWorkbench();
  const state = useReplicatedState(changes?.state);
  const [selected, setSelected] = useState<string | null>(() => state?.files[0]?.path ?? null);
  const initialized = useRef(selected !== null);
  const [reading] = useState<DiffReadingState>(() => ({ positions: new Map(), revealed: new WeakSet() }));
  /** The place the diff is scrolling to, kept while this panel is shown. */
  const [revealed, setRevealed] = useState<ChangeTarget | null>(null);
  const [inlineStyled, setInlineStyled] = useState<"split" | "unified">(() => storedDiffStyle("inline"));
  const [zoomedStyled, setZoomedStyled] = useState<"split" | "unified">(() => storedDiffStyle("fullscreen"));
  const [inlineWrap, setInlineWrap] = useState<boolean>(() => storedDiffWrap(false));
  const [zoomedWrap, setZoomedWrap] = useState<boolean>(() => storedDiffWrap(true));
  const [loaded, setLoaded] = useState<LoadedPatch | null>(null);
  const [readFailure, setReadFailure] = useState<string | null>(null);

  // A place was asked for—a comment of the review: show its file, which the diff then scrolls to the line of. A file
  // the list does not hold (a comment on a file that did not change) has no diff to scroll, so it is opened where it
  // is, in the files view. The request is settled either way: asking is not repeated as the list changes.
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

  // Only an authoritative file list can remove a selection. A released or reconnecting service cannot.
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
      <p className="flex shrink-0 flex-wrap items-baseline gap-x-2 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {state.files.length === 0
            ? "No changed files"
            : `${state.files.length} changed ${state.files.length === 1 ? "file" : "files"}`}
          {state.base !== undefined && ` against ${state.base}`}
        </span>
        <Totals files={state.files} />
      </p>
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="changes" minSize={80} className="overflow-auto px-2 pb-2">
          <SidebarMenu aria-label="Changed files">
            {state.files.map((file) => (
              <SidebarMenuItem key={file.path}>
                <SidebarMenuButton isActive={file.path === selected} onClick={() => setSelected(file.path)}>
                  <span className={cn("w-3 shrink-0 font-medium", statusColor(file.status))}>
                    {statusLetter(file.status)}
                  </span>
                  <FileIcon fileName={file.path.split("/").pop() ?? file.path} autoAssign />
                  <span className="truncate font-mono text-xs" title={statusLabel(file.status, file.from)}>
                    {file.path}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums">
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
                reading={reading}
                active={active}
                file={selectedFile}
                reveal={revealed ?? undefined}
                patch={loaded?.path === selectedFile.path ? loaded.patch : null}
                failure={readFailure}
                inlineStyled={inlineStyled}
                onInlineStyled={setInlineStyled}
                zoomedStyled={zoomedStyled}
                onZoomedStyled={setZoomedStyled}
                inlineWrap={inlineWrap}
                onInlineWrap={setInlineWrap}
                zoomedWrap={zoomedWrap}
                onZoomedWrap={setZoomedWrap}
                comments={comments}
                onClose={() => setSelected(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * Every listed file's lines added and deleted, summed: how much the whole project differs from the base commit. A
 * binary file counts as neither, and so are files the list could not hold beyond its limit.
 */
function Totals({ files }: { files: readonly ChangedFile[] }) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  const parts: CountPart[] = countParts(additions, deletions);
  if (parts.length === 0) return null;
  return (
    <span className="flex items-center gap-1 font-mono tabular-nums">
      {parts.map((part) => (
        <span key={part.kind} className={part.kind === "additions" ? ADDITIONS_COLOR : DELETIONS_COLOR}>
          {part.text}
        </span>
      ))}
    </span>
  );
}

function titleOf(status: "ready" | "notRepository" | "error"): string {
  if (status === "notRepository") return "Not a Git repository";
  return status === "error" ? "Cannot read the changes" : "Changes";
}

/** The selected file's patch, with the controls that change how it is shown. */
function ChangeView({
  reading,
  active,
  file,
  patch,
  failure,
  inlineStyled,
  onInlineStyled,
  zoomedStyled,
  onZoomedStyled,
  inlineWrap,
  onInlineWrap,
  zoomedWrap,
  onZoomedWrap,
  comments,
  reveal,
  onClose,
}: {
  reading: DiffReadingState;
  active: boolean;
  file: ChangedFile;
  patch: FilePatch | null;
  failure: string | null;
  inlineStyled: "split" | "unified";
  onInlineStyled(style: "split" | "unified"): void;
  zoomedStyled: "split" | "unified";
  onZoomedStyled(style: "split" | "unified"): void;
  inlineWrap: boolean;
  onInlineWrap(wrap: boolean): void;
  zoomedWrap: boolean;
  onZoomedWrap(wrap: boolean): void;
  comments: ProjectComments;
  reveal?: ChangeTarget;
  onClose(): void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) setZoomed(false);
  }, [active]);
  const isMobile = useIsMobile();
  const [mobileStyle, setMobileStyle] = useState(() => storedDiffStyle("narrow"));
  const styled = isMobile ? mobileStyle : zoomed ? zoomedStyled : inlineStyled;
  const wrap = zoomed ? zoomedWrap : inlineWrap;
  const next = styled === "split" ? "unified" : "split";
  const parts = countParts(file.additions, file.deletions);

  const toggleWrap = (): void => {
    const nextWrap = !wrap;
    preferences.setItem(zoomed ? DIFF_WRAP_ZOOMED_KEY : DIFF_WRAP_KEY, String(nextWrap));
    if (zoomed) {
      onZoomedWrap(nextWrap);
    } else {
      onInlineWrap(nextWrap);
    }
  };

  const toggleStyled = (): void => {
    if (isMobile) {
      setMobileStyle(next);
      preferences.setItem(DIFF_STYLE_MOBILE_KEY, next);
      return;
    }
    preferences.setItem(zoomed ? DIFF_STYLE_ZOOMED_KEY : DIFF_STYLE_KEY, next);
    if (zoomed) {
      onZoomedStyled(next);
    } else {
      onInlineStyled(next);
    }
  };

  return (
    <ReaderSurface toggleRef={toggleRef} expanded={zoomed} onExpandedChange={setZoomed} label={`Diff of ${file.path}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <p className="min-w-0 truncate font-mono text-xs" title={statusLabel(file.status, file.from)}>
            {file.path}
          </p>
          <CopyPathButton key={file.path} path={file.path} />
        </div>
        {parts.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
            {parts.map((part) => (
              <span key={part.kind} className={part.kind === "additions" ? ADDITIONS_COLOR : DELETIONS_COLOR}>
                {part.text}
              </span>
            ))}
          </span>
        )}
        <ReaderWrapButton wrap={wrap} onToggle={toggleWrap} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={next === "split" ? "Show the diff in two columns" : "Show the diff in one column"}
                onClick={toggleStyled}
              />
            }
          >
            {styled === "split" ? <Columns2Icon /> : <Rows2Icon />}
          </TooltipTrigger>
          <TooltipContent>{next === "split" ? "Two columns" : "One column"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                ref={toggleRef}
                variant={zoomed ? "secondary" : "ghost"}
                size="icon-xs"
                aria-label={zoomed ? "Exit full screen" : "Full screen"}
                aria-pressed={zoomed}
                onClick={() => setZoomed((current) => !current)}
              />
            }
          >
            {zoomed ? <Minimize2Icon /> : <Maximize2Icon />}
          </TooltipTrigger>
          <TooltipContent>{zoomed ? "Exit full screen" : "Full screen"}</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close the diff"
          onClick={() => {
            setZoomed(false);
            onClose();
          }}
        >
          <XIcon />
        </Button>
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
          <ChangeDiff
            reading={reading}
            key={file.path}
            path={file.path}
            patch={patch}
            style={styled}
            wrap={wrap}
            comments={comments}
            reveal={reveal}
          />
        )}
      </div>
    </ReaderSurface>
  );
}

export function storedDiffStyle(surface: "inline" | "fullscreen" | "narrow"): "split" | "unified" {
  if (surface === "narrow") return preferences.getItem(DIFF_STYLE_MOBILE_KEY) === "split" ? "split" : "unified";
  if (surface === "fullscreen") {
    return preferences.getItem(DIFF_STYLE_ZOOMED_KEY) === "unified" ? "unified" : "split";
  }
  const stored = preferences.getItem(DIFF_STYLE_KEY);
  return stored === "split" ? "split" : "unified";
}

export function storedDiffWrap(zoomed: boolean): boolean {
  if (zoomed) {
    return preferences.getItem(DIFF_WRAP_ZOOMED_KEY) === "true";
  }
  return preferences.getItem(DIFF_WRAP_KEY) === "true";
}
