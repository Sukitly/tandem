import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnchoredCommentEditor } from "@/comments/anchored-comment-editor.tsx";
import { placeThreads, revealedLine, threadsByLine } from "@/comments/comment-anchor.ts";
import { CommentThreadBox } from "@/comments/comment-box.tsx";
import { type ProjectComments, useCommentThreads } from "@/comments/project-comments.ts";
import { useCommentDrafts } from "@/comments/use-comment-drafts.ts";
import { LoadingView } from "@/components/loading-view.tsx";
import { useHighlightedCode } from "@/hooks/use-highlighted-code.ts";
import { lazyExport } from "@/lib/lazy-export.ts";
import { cn } from "@/lib/utils.ts";
import { languageOfFile } from "./file-language.ts";
import type { OpenedFile } from "./project-files.ts";

const MAX_HIGHLIGHTED_LINES = 3000;

/** A long file draws with `@pierre/diffs`, which is loaded when the first one is drawn. */
const VirtualFile = lazyExport(() => import("./virtual-file.tsx"), "VirtualFile");

/**
 * The text with line numbers, highlighted unless it is long; the asked-for line is marked and scrolled to.
 */
export function FileText({
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
  const virtual = lines.length > MAX_HIGHLIGHTED_LINES;
  // A long file is drawn by the virtual list, which highlights for itself: nothing is highlighted here.
  const highlighted = useHighlightedCode(
    virtual ? "" : body,
    virtual ? "" : languageOfFile(path.slice(path.lastIndexOf("/") + 1)),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const threads = useCommentThreads(comments);

  const placed = useMemo(
    () => placeThreads(threads, path, "additions", (number) => lines[number - 1], lines.length),
    [threads, path, lines],
  );
  const byLine = useMemo(() => threadsByLine(placed), [placed]);
  const [focusedLine, setFocusedLine] = useState(1);

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

  const isAbove = opened.threadId !== undefined && above.some(({ thread }) => thread.id === opened.threadId);
  const line = isAbove ? undefined : revealedLine(placed, opened.threadId, opened.line);
  const draftLines = useMemo(() => ({ additions: new Map(lines.map((text, index) => [index + 1, text])) }), [lines]);
  const drafts = useCommentDrafts(comments.workspaceId, path, "file", draftLines);

  const shown = useRef<OpenedFile | null>(null);
  useEffect(() => {
    if (shown.current === opened || (line === undefined && !isAbove)) return;
    shown.current = opened;
    const target = isAbove ? `[data-thread="${opened.threadId}"]` : `[data-line="${line}"]`;
    scroller.current?.querySelector(target)?.scrollIntoView({ block: "center" });
  }, [opened, line, isAbove]);

  if (virtual) {
    return (
      <Suspense fallback={<LoadingView />}>
        <VirtualFile
          text={text}
          lines={lines}
          opened={opened}
          comments={comments}
          placed={placed}
          above={above}
          line={line}
          wrap={wrap}
          drafts={drafts}
        />
      </Suspense>
    );
  }

  return (
    <div ref={scroller} className="h-full overflow-auto">
      {drafts.detached.map((draft) => (
        <AnchoredCommentEditor
          key={draft.record.id}
          draft={draft}
          store={drafts.store}
          comments={comments}
          view={scroller}
        />
      ))}
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
                    onClick={() => drafts.start("additions", number)}
                  >
                    <span className="group-hover/line:hidden">{number}</span>
                    <span className="hidden group-hover/line:inline">+</span>
                  </button>
                  <span className={cn("min-h-[1lh] pr-4", wrap && "min-w-0 flex-1 whitespace-pre-wrap break-all")}>
                    {highlighted[index] ?? content}
                  </span>
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
                {drafts.byLine.get(`additions:${number}`)?.map((draft) => (
                  <AnchoredCommentEditor
                    key={draft.record.id}
                    draft={draft}
                    store={drafts.store}
                    comments={comments}
                    view={scroller}
                    className="ml-14"
                  />
                ))}
              </Fragment>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
