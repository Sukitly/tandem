import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewDiffItem, type CodeViewHandle, type DiffLineAnnotation } from "@pierre/diffs/react";
import type { CommentThread, FilePatch } from "@tandem/contracts";
import { PlusIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import {
  anchorAt,
  indexLines,
  type PlacedThread,
  placeThreads,
  relocate,
  revealedLine,
} from "@/comments/comment-anchor.ts";
import { CommentDraft, CommentThreadBox } from "@/comments/comment-box.tsx";
import { type ProjectComments, useCommentThreads } from "@/comments/project-comments.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRenderVersion } from "@/hooks/use-render-version.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useTheme } from "@/theme.tsx";
import type { ChangeTarget } from "./change-target.ts";
import { diffLine, diffLineCount, diffLines } from "./diff-lines.ts";
import { DIFF_COMMENT_CSS } from "./diff-plain-annotations.ts";
import { controlPlacement, useHoveredLine } from "./hovered-line.ts";

type Side = "additions" | "deletions";

/** A line of the diff being commented on. */
interface Draft {
  side: Side;
  line: number;
}

/** What is written on a line of the diff: a thread, or the one being started. */
type Annotation = { kind: "thread"; thread: CommentThread } | { kind: "draft"; draft: Draft };

/**
 * One file's patch, as `@pierre/diffs` renders it, with the review's comments on its lines. A comment is written the
 * way a code host does it: a button beside the number of the line the pointer is on, or the number itself. The patch's
 * own header is off: the panel's header names the path already.
 */
export function ChangeDiff({
  path,
  patch,
  style,
  wrap = false,
  comments,
  reveal,
}: {
  path: string;
  patch: FilePatch;
  style: "split" | "unified";
  wrap?: boolean;
  comments: ProjectComments;
  /** A place of this file asked for, which the diff scrolls to. */
  reveal?: ChangeTarget;
}) {
  const { choice } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const { hovered, onLineEnter, onLineLeave } = useHoveredLine(box);
  const { openFile } = useWorkbench();
  const text = patch.kind === "patch" ? patch.patch : "";
  const threads = useCommentThreads(comments);
  const [draft, setDraft] = useState<Draft | null>(null);
  const lineInputId = useId();
  const [lineInput, setLineInput] = useState("1");
  const [sideInput, setSideInput] = useState<Side>("additions");
  const [lineError, setLineError] = useState<string | null>(null);

  const files = useMemo(() => (text.trim() === "" ? [] : parsePatchFiles(text).flatMap((file) => file.files)), [text]);
  // Missing hunk lines are checked against the file, but their comments remain visible while that read is pending.
  const placed = useMemo<PlacedThread[]>(() => {
    const fileDiff = files[0];
    if (fileDiff === undefined) return [];
    if (threads.length === 0) return [];
    return (["additions", "deletions"] as const).flatMap((side) => {
      const lines = diffLines(fileDiff, side);
      return placeThreads(threads, path, side, (line) => lines.get(line), diffLineCount(fileDiff, side), lines.keys());
    });
  }, [files, threads, path]);
  const detached = useDetachedThreads(comments.workspaceId, path, text, placed);
  const version = useRenderVersion([text, placed, draft]);

  const items = useMemo<CodeViewDiffItem<Annotation>[]>(() => {
    const annotations: DiffLineAnnotation<Annotation>[] = placed.flatMap(({ thread, line }) =>
      line === undefined
        ? []
        : [{ side: thread.anchor.side ?? "additions", lineNumber: line, metadata: { kind: "thread", thread } }],
    );
    if (draft !== null) {
      annotations.push({ side: draft.side, lineNumber: draft.line, metadata: { kind: "draft", draft } });
    }
    // Keep identity stable across edits so the renderer can preserve the reading position.
    return files.map((fileDiff, index) => ({
      id: `${path}#${index}`,
      type: "diff",
      fileDiff,
      annotations,
      version,
    }));
  }, [path, version, files, placed, draft]);

  // Scroll to the place that was asked for, once, as soon as the patch is rendered and can be scrolled.
  const revealed = useRef<ChangeTarget | null>(null);
  useEffect(() => {
    const item = items[0];
    if (reveal === undefined || reveal.path !== path || reveal.line === undefined) return;
    if (item === undefined || revealed.current === reveal) return;
    const missing = detached.find(({ thread }) => thread.id === reveal.threadId);
    if (missing !== undefined) {
      box.current?.parentElement
        ?.querySelector(`[data-detached-thread="${missing.thread.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
      revealed.current = reveal;
      return;
    }
    revealed.current = reveal;
    // A thread has moved with its line. One the patch does not show, outdated or out of its hunks, has only the line it
    // had.
    view.current?.scrollTo({
      type: "line",
      id: item.id,
      lineNumber: revealedLine(placed, reveal.threadId, reveal.line) ?? reveal.line,
      side: reveal.side ?? "additions",
      align: "center",
    });
  }, [reveal, items, path, placed, detached]);

  /** Write a comment on a line. A patch holds one file. */
  const startDraft = (side: Side, line: number): void => {
    if (files[0] === undefined) return;
    setDraft({ side, line });
  };

  if (patch.kind !== "patch") {
    const message =
      patch.kind === "binary"
        ? "A binary file: there are no lines to show."
        : patch.kind === "tooLarge"
          ? "This file's diff is too large to show."
          : patch.message;
    return <p className="p-3 text-sm text-muted-foreground">{message}</p>;
  }
  if (items.length === 0) return <p className="p-3 text-sm text-muted-foreground">No line changes.</p>;
  // A line that is being commented on, or already carries a comment, has nothing to add: no button is shown there.
  const taken =
    hovered !== null &&
    ((draft !== null && draft.line === hovered.line && draft.side === hovered.side) ||
      placed.some(({ thread, line }) => line === hovered.line && (thread.anchor.side ?? "additions") === hovered.side));
  return (
    <div className="flex h-full min-h-0 flex-col">
      {detached.length > 0 && (
        <div className="max-h-1/2 shrink-0 overflow-auto border-b">
          {detached.map(({ thread, line, reason }) => (
            <div key={thread.id} data-detached-thread={thread.id}>
              <CommentThreadBox thread={thread} comments={comments} detached={reason} />
              {reason === "outside" && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => openFile(path, { threadId: thread.id, line: line ?? thread.anchor.line })}
                >
                  Show comment in file
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <details className="shrink-0 border-b px-3 py-1 text-xs">
        <summary className="cursor-pointer py-1">Comment on a line</summary>
        <form
          className="flex flex-wrap items-center gap-2 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            const line = Number(lineInput);
            if (
              !Number.isSafeInteger(line) ||
              line < 1 ||
              files[0] === undefined ||
              diffLine(files[0], sideInput, line) === undefined
            ) {
              setLineError("Choose a line shown in this diff.");
              return;
            }
            setLineError(null);
            startDraft(sideInput, line);
          }}
        >
          <label htmlFor={lineInputId}>
            Line{" "}
            <Input
              id={lineInputId}
              className="w-20"
              type="number"
              min={1}
              required
              value={lineInput}
              onChange={(event) => setLineInput(event.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={sideInput === "additions"}
            onClick={() => setSideInput("additions")}
          >
            New file
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={sideInput === "deletions"}
            onClick={() => setSideInput("deletions")}
          >
            Old file
          </Button>
          <Button type="submit" size="sm">
            Add comment
          </Button>
          {lineError !== null && <p role="alert">{lineError}</p>}
        </form>
      </details>
      <div ref={box} className="relative min-h-0 flex-1">
        {/* The line the pointer is on, where a code host shows it: beside the number, half over the code. */}
        {hovered !== null && !taken && (
          <Button
            type="button"
            variant="default"
            size="icon-xs"
            aria-label={`Comment on line ${hovered.line}`}
            className="absolute z-10"
            style={controlPlacement(hovered)}
            onClick={() => startDraft(hovered.side, hovered.line)}
          >
            <PlusIcon />
          </Button>
        )}
        <CodeView
          ref={view}
          className="h-full overflow-auto text-xs"
          items={items}
          options={{
            theme: { dark: "github-dark", light: "github-light" },
            themeType: choice,
            unsafeCSS: DIFF_COMMENT_CSS,
            diffStyle: style,
            disableFileHeader: true,
            overflow: wrap ? "wrap" : "scroll",
            // Clicking a line's number writes a comment on it too. The library's own hover button is left off: its button
            // and the row it marks belong to the item, and a comment arriving re-renders the item, which strands both on
            // the row they were on.
            onLineEnter,
            onLineLeave,
            onLineClick: (props) => {
              if (
                !("annotationSide" in props) ||
                (props.event.pointerType !== "touch" && props.event.pointerType !== "pen")
              )
                return;
              if (props.event.detail > 1 || window.getSelection()?.isCollapsed === false) return;
              startDraft(props.annotationSide, props.lineNumber);
            },
            onLineNumberClick: (props) => {
              // A file item has no sides; this view holds diff items.
              if (!("annotationSide" in props)) return;
              startDraft(props.annotationSide, props.lineNumber);
            },
          }}
          renderAnnotation={(annotation) => {
            const written = annotation.metadata;
            if (written === undefined) return null;
            if (written.kind === "draft") {
              const { draft } = written;
              return (
                <CommentDraft
                  draftKey={JSON.stringify(["comment", comments.workspaceId, path, draft.side, draft.line])}
                  place={`${path}:${draft.line}`}
                  view={box}
                  onSave={async (note) => {
                    const fileDiff = files[0];
                    if (fileDiff === undefined) return;
                    const anchor = anchorAt({ path, line: draft.line, side: draft.side }, (line) =>
                      diffLine(fileDiff, draft.side, line),
                    );
                    // The new file's lines are the file as it is; a thread on them carries no side.
                    if (draft.side === "additions") delete anchor.side;
                    await comments.start(anchor, note);
                    setDraft(null);
                  }}
                  onCancel={() => setDraft(null)}
                />
              );
            }
            return <CommentThreadBox thread={written.thread} comments={comments} view={box} />;
          }}
        />
      </div>
    </div>
  );
}

/**
 * Threads outside the displayed hunks stay visible. Read the file to distinguish an unchanged context line from
 * a deleted line; while loading or on failure, offer Files instead of claiming the comment is outdated.
 * Missing deletion-side threads have no current file to search.
 */
function useDetachedThreads(
  workspaceId: number,
  path: string,
  patchText: string,
  placed: readonly PlacedThread[],
): (PlacedThread & { reason: "outdated" | "outside" })[] {
  const { files } = useConnected();
  const missing = placed.filter((entry) => entry.line === undefined);
  const needsFile = missing.some(({ thread }) => thread.anchor.side !== "deletions");
  const [file, setFile] = useState<{ key: string; lines: string[] | null } | null>(null);
  const key = `${workspaceId}#${path}#${patchText}`;

  useEffect(() => {
    if (!needsFile) return;
    let cancelled = false;
    files.read({ workspaceId, path }, BACKGROUND_CONTEXT).then(
      (content) => {
        if (cancelled) return;
        const text = content.kind === "text" ? content.text : null;
        const body = text?.endsWith("\n") === true ? text.slice(0, -1) : text;
        setFile({ key, lines: body === null || body === undefined ? null : body.split("\n") });
      },
      // A failed read cannot prove a line was removed. Keep the comment available with a link to Files.
      () => {
        if (!cancelled) setFile({ key, lines: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, workspaceId, path, key, needsFile]);

  const lines = file?.key === key ? file.lines : undefined;
  const index = useMemo(
    () => (lines == null ? new Map<string, number[]>() : indexLines((line) => lines[line - 1], lines.length)),
    [lines],
  );
  return missing.map(({ thread }) => {
    if (thread.anchor.side === "deletions") return { thread, reason: "outdated" };
    if (lines === undefined || lines === null) return { thread, reason: "outside" };
    const line = relocate(thread.anchor, (line) => lines[line - 1], lines.length, index.get(thread.anchor.quote) ?? []);
    return { thread, line, reason: line === undefined ? "outdated" : "outside" };
  });
}
