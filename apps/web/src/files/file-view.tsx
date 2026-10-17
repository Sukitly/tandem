import { AlertCircleIcon, FileIcon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { HighlightedLine, languageOfFile, useHighlighted } from "@/chat/highlight.tsx";
import { anchorAt, placeThreads, revealedLine, threadsByLine } from "@/comments/comment-anchor.ts";
import { CommentDraft, CommentThreadBox } from "@/comments/comment-box.tsx";
import { type ProjectComments, useCommentThreads } from "@/comments/project-comments.ts";
import { CopyPathButton } from "@/components/copy-path-button.tsx";
import { ReaderSurface, ReaderWrapButton } from "@/components/reader-surface.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preferences } from "@/lib/preferences.ts";
import { cn } from "@/lib/utils";
import { type OpenedFile, type ProjectFiles, useProjectFiles } from "./project-files.ts";
import { VirtualFile } from "./virtual-file.tsx";

/** Highlighting a longer file would hold up the page for a second or more; it shows as plain text instead. */
const MAX_HIGHLIGHTED_LINES = 3000;

/** The opened file of the files panel, shown at its line if one was asked for. */
export function FileView({
  files,
  comments,
  active = true,
}: {
  files: ProjectFiles;
  comments: ProjectComments;
  active?: boolean;
}) {
  const opened = useProjectFiles(files, (current) => current.opened);
  const content = useProjectFiles(files, (current) => current.content);
  const lineCount = useMemo(
    () => (content?.status === "ready" && content.value.kind === "text" ? countLines(content.value.text) : 0),
    [content],
  );
  const [zoomed, setZoomed] = useState(false);
  const [wrap, setWrap] = useState(() => preferences.getItem("tandem.fileWrap") === "true");
  const toggleWrap = (): void => {
    setWrap(!wrap);
    preferences.setItem("tandem.fileWrap", String(!wrap));
  };
  useEffect(() => {
    if (!active) setZoomed(false);
  }, [active]);

  if (opened === null) return null;
  return (
    <ReaderSurface expanded={zoomed} onExpandedChange={setZoomed} label={`File ${opened.path}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <p className="min-w-0 truncate font-mono text-xs" title={opened.path}>
            {opened.path}
          </p>
          <CopyPathButton key={opened.path} path={opened.path} />
        </div>
        {content?.status === "ready" && content.value.kind === "text" && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatLines(lineCount)}</span>
        )}
        <ReaderWrapButton wrap={wrap} onToggle={toggleWrap} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
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
          aria-label="Close the file"
          onClick={() => {
            setZoomed(false);
            files.close();
          }}
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {content === null || content.status === "loading" ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <Spinner />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : content.status === "failed" ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Cannot open the file</AlertTitle>
              <AlertDescription>{content.message}</AlertDescription>
            </Alert>
          </div>
        ) : content.value.kind === "text" ? (
          <FileText key={opened.path} text={content.value.text} opened={opened} comments={comments} wrap={wrap} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileIcon />
              </EmptyMedia>
              <EmptyTitle>{content.value.kind === "binary" ? "Binary file" : "Too large to show"}</EmptyTitle>
              <EmptyDescription>
                {content.value.kind === "binary"
                  ? "It is not text, so it is not shown."
                  : "Files over 1 MB are not shown."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ReaderSurface>
  );
}

/**
 * The text with line numbers, highlighted unless it is long; the asked-for line is marked and scrolled to. A comment
 * is written by clicking a line's number, and shown under the line it is about.
 */
function FileText({
  text,
  opened,
  comments,
  wrap,
}: {
  text: string;
  opened: OpenedFile;
  comments: ProjectComments;
  wrap: boolean;
}) {
  const { path } = opened;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = useMemo(() => body.split("\n"), [body]);
  const [virtual, setVirtual] = useState(lines.length > MAX_HIGHLIGHTED_LINES);
  if (!virtual && lines.length > MAX_HIGHLIGHTED_LINES) setVirtual(true);
  const language =
    lines.length <= MAX_HIGHLIGHTED_LINES ? languageOfFile(path.slice(path.lastIndexOf("/") + 1)) : undefined;
  const tokens = useHighlighted(body, language, false);
  const scroller = useRef<HTMLDivElement>(null);
  const threads = useCommentThreads(comments);
  // Each thread on the line its text is on now; those whose line is gone are shown above the file.
  const placed = useMemo(
    () => placeThreads(threads, path, "additions", (number) => lines[number - 1], lines.length),
    [threads, path, lines],
  );
  const byLine = useMemo(() => threadsByLine(placed), [placed]);
  const [focusedLine, setFocusedLine] = useState(1);
  // Threads on lines the changes removed: the file has no such line, so they are shown above it with the code they
  // were written on, as the diff shows them on its removed side.
  const removed = useMemo(
    () => threads.filter((thread) => thread.anchor.path === path && thread.anchor.side === "deletions"),
    [threads, path],
  );
  const above = [
    ...placed.flatMap((entry) =>
      entry.line === undefined ? [{ thread: entry.thread, why: "outdated" as const }] : [],
    ),
    ...removed.map((thread) => ({ thread, why: "removed" as const })),
  ];
  // A thread above the file has no line of it to show; a thread on a line is shown on the line it moved to.
  const isAbove = opened.threadId !== undefined && above.some(({ thread }) => thread.id === opened.threadId);
  const line = isAbove ? undefined : revealedLine(placed, opened.threadId, opened.line);
  const [draft, setDraft] = useState<number | null>(null);

  // Each request to show a place is a new `opened`, so asking again for the same place shows it again. Shown once: as
  // threads come and go, the view stays where the user scrolled it.
  const shown = useRef<OpenedFile | null>(null);
  useEffect(() => {
    if (shown.current === opened || (line === undefined && !isAbove)) return;
    shown.current = opened;
    const target = isAbove ? `[data-thread="${opened.threadId}"]` : `[data-line="${line}"]`;
    scroller.current?.querySelector(target)?.scrollIntoView({ block: "center" });
  }, [opened, line, isAbove]);

  if (virtual || lines.length > MAX_HIGHLIGHTED_LINES) {
    return (
      <VirtualFile
        text={text}
        lines={lines}
        opened={opened}
        comments={comments}
        placed={placed}
        above={above}
        line={line}
        wrap={wrap}
        draft={draft}
        setDraft={setDraft}
      />
    );
  }

  return (
    <div ref={scroller} className="h-full overflow-auto">
      {above.map(({ thread, why }) => (
        <div key={thread.id} data-thread={thread.id}>
          <CommentThreadBox thread={thread} comments={comments} view={scroller} detached={why} />
        </div>
      ))}
      <pre className={cn("py-2 font-mono text-xs leading-relaxed", wrap ? "w-full" : "w-max min-w-full")}>
        <code>
          {lines.map((content, index) => {
            const number = index + 1;
            return (
              <Fragment key={number}>
                <div data-line={number} className={cn("group/line flex", number === line && "bg-primary/10")}>
                  <button
                    type="button"
                    aria-label={`Comment on line ${number}`}
                    title="Comment on this line (arrow keys move between lines)"
                    tabIndex={number === Math.min(focusedLine, lines.length) ? 0 : -1}
                    onFocus={() => setFocusedLine(number)}
                    onKeyDown={(event) => {
                      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                      const next =
                        event.key === "ArrowDown"
                          ? number + 1
                          : event.key === "ArrowUp"
                            ? number - 1
                            : event.key === "Home"
                              ? 1
                              : event.key === "End"
                                ? lines.length
                                : undefined;
                      if (next === undefined) return;
                      event.preventDefault();
                      const target = Math.max(1, Math.min(lines.length, next));
                      setFocusedLine(target);
                      scroller.current?.querySelector<HTMLButtonElement>(`[data-line="${target}"] button`)?.focus();
                    }}
                    className="sticky left-0 w-12 shrink-0 cursor-pointer bg-background pr-4 text-right text-muted-foreground select-none"
                    onClick={() => setDraft(number)}
                  >
                    <span className="group-hover/line:hidden">{number}</span>
                    <span className="hidden group-hover/line:inline">+</span>
                  </button>
                  {tokens?.[index] === undefined ? (
                    <span className={cn("min-h-[1lh] pr-4", wrap && "min-w-0 flex-1 whitespace-pre-wrap break-all")}>
                      {content}
                    </span>
                  ) : (
                    <HighlightedLine
                      tokens={tokens[index]}
                      className={cn("min-h-[1lh] pr-4", wrap && "min-w-0 flex-1 whitespace-pre-wrap break-all")}
                    />
                  )}
                </div>
                {byLine.get(number)?.map((thread) => (
                  <CommentThreadBox
                    key={thread.id}
                    thread={thread}
                    comments={comments}
                    view={scroller}
                    className="ml-14"
                  />
                ))}
                {draft === number && (
                  <CommentDraft
                    draftKey={JSON.stringify(["comment", comments.workspaceId, path, "additions", number])}
                    place={`${path}:${number}`}
                    view={scroller}
                    className="ml-14"
                    onSave={async (note) => {
                      await comments.start(
                        anchorAt({ path, line: number }, (at) => lines[at - 1]),
                        note,
                      );
                      setDraft(null);
                    }}
                    onCancel={() => setDraft(null)}
                  />
                )}
              </Fragment>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = text.endsWith("\n") ? 0 : 1;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) count += 1;
  return count;
}

export function formatLines(count: number): string {
  return `${count.toLocaleString()} L`;
}
