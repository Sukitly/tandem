import { parsePatchFiles } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewHandle,
  type CodeViewProps,
  type DiffLineAnnotation,
} from "@pierre/diffs/react";
import type { FilePatch } from "@tandem/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CODE_COMMENT_CSS } from "@/comments/code-comment-style.ts";
import { type PlacedThread, placeThreads, revealedLine } from "@/comments/comment-anchor.ts";
import {
  type CommentAnnotation as Annotation,
  CommentAnnotationView,
  DetachedCommentDrafts,
} from "@/comments/comment-annotations.tsx";
import { type ProjectComments, useCommentThreads } from "@/comments/project-comments.ts";
import { useCommentDrafts } from "@/comments/use-comment-drafts.ts";
import { useRenderVersion } from "@/hooks/use-render-version.ts";
import { useTheme } from "@/theme.tsx";
import type { ChangeTarget } from "./change-target.ts";
import { DetachedThreads } from "./detached-threads.tsx";
import { diffLineCount, diffLines } from "./diff-lines.ts";
import { useDetachedThreads } from "./use-detached-threads.ts";

type Side = "additions" | "deletions";

/** Local reading intent outlives a temporarily released changes service, not its replicated file list. */
export interface DiffReadingState {
  positions: Map<string, number>;
  revealed: WeakSet<ChangeTarget>;
}

/** What is written on a line of the diff: a thread or an independently identified pending draft. */

/**
 * One file's patch, as `@pierre/diffs` renders it, with the review's comments on its lines. A comment is written the
 * way a code host does it: a button beside the number of the line the pointer is on, or the number itself. The patch's
 * own header is off: the panel's header names the path already.
 */
export function ChangeDiff({
  reading,
  path,
  patch,
  style,
  wrap = false,
  comments,
  reveal,
}: {
  reading?: DiffReadingState;
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
  const text = patch.kind === "patch" ? patch.patch : "";
  const threads = useCommentThreads(comments);

  const files = useMemo(() => (text.trim() === "" ? [] : parsePatchFiles(text).flatMap((file) => file.files)), [text]);
  const draftLines = useMemo(
    () =>
      files[0] === undefined
        ? {}
        : { additions: diffLines(files[0], "additions"), deletions: diffLines(files[0], "deletions") },
    [files],
  );
  const drafts = useCommentDrafts(comments.workspaceId, path, "diff", draftLines);
  const orphaned = <DetachedCommentDrafts drafts={drafts} comments={comments} view={box} />;
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
  const {
    threads: detached,
    pending: verifying,
    failure: verificationFailure,
    retry: retryVerification,
  } = useDetachedThreads(comments.workspaceId, path, text, placed);
  const version = useRenderVersion([text, placed, drafts.placed]);

  const items = useMemo<CodeViewDiffItem<Annotation>[]>(() => {
    const annotations: DiffLineAnnotation<Annotation>[] = placed.flatMap(({ thread, line }) =>
      line === undefined
        ? []
        : [{ side: thread.anchor.side ?? "additions", lineNumber: line, metadata: { kind: "thread", thread } }],
    );
    for (const draft of drafts.placed) {
      if (draft.line !== undefined)
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
  }, [path, version, files, placed, drafts.placed]);

  const initialScroll = useRef(reading?.positions.get(path) ?? 0);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || items.length === 0) return;
    restored.current = true;
    if (reveal === undefined || reading?.revealed.has(reveal))
      view.current?.scrollTo({ type: "position", position: initialScroll.current });
  }, [items, reading, reveal]);

  // Scroll to the place that was asked for, once, as soon as the patch is rendered and can be scrolled.
  const revealed = useRef<ChangeTarget | null>(null);
  useEffect(() => {
    const item = items[0];
    if (reveal === undefined || reveal.path !== path || reveal.line === undefined) return;
    if (item === undefined || revealed.current === reveal || reading?.revealed.has(reveal)) return;
    reading?.revealed.add(reveal);
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
  }, [reveal, items, path, placed, detached, reading]);

  /** Write a comment on a line. A patch holds one file. */
  const start = drafts.start;
  const startDraft = useCallback(
    (side: Side, line: number): void => {
      if (files[0] === undefined) return;
      start(side, line);
    },
    [files, start],
  );

  const options: CodeViewProps<Annotation, undefined>["options"] = useMemo(
    () => ({
      theme: { dark: "github-dark", light: "github-light" },
      themeType: choice,
      unsafeCSS: CODE_COMMENT_CSS,
      diffStyle: style,
      disableFileHeader: true,
      overflow: wrap ? "wrap" : "scroll",
      lineHoverHighlight: "both",
      onLineClick: (props) => {
        if (!("annotationSide" in props) || (props.event.pointerType !== "touch" && props.event.pointerType !== "pen"))
          return;
        if (props.event.detail > 1 || window.getSelection()?.isCollapsed === false) return;
        startDraft(props.annotationSide, props.lineNumber);
      },
      onLineNumberClick: (props) => {
        // A file item has no sides; this view holds diff items.
        if (!("annotationSide" in props)) return;
        startDraft(props.annotationSide, props.lineNumber);
      },
    }),
    [choice, style, wrap, startDraft],
  );

  if (patch.kind !== "patch") {
    const message =
      patch.kind === "binary"
        ? "A binary file: there are no lines to show."
        : patch.kind === "tooLarge"
          ? "This file's diff is too large to show."
          : patch.message;
    return (
      <div>
        {orphaned}
        <p className="p-3 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }
  if (items.length === 0)
    return (
      <div>
        {orphaned}
        <p className="p-3 text-sm text-muted-foreground">No line changes.</p>
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {orphaned}
      <DetachedThreads
        path={path}
        comments={comments}
        threads={detached}
        verifying={verifying}
        failure={verificationFailure}
        onRetry={retryVerification}
      />
      <div ref={box} className="relative min-h-0 flex-1">
        <CodeView
          onScroll={(top) => {
            if (restored.current) reading?.positions.set(path, top);
          }}
          ref={view}
          className="h-full overflow-auto text-xs"
          items={items}
          options={options}
          renderAnnotation={(annotation) => (
            <CommentAnnotationView annotation={annotation.metadata} drafts={drafts} comments={comments} view={box} />
          )}
        />
      </div>
    </div>
  );
}
