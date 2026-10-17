import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { parsePatchFiles } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewHandle,
  type CodeViewProps,
  type DiffLineAnnotation,
} from "@pierre/diffs/react";
import type { CommentThread, FilePatch } from "@tandem/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkbench } from "@/app/workbench.tsx";
import { AnchoredCommentEditor } from "@/comments/anchored-comment-editor.tsx";
import { indexLines, type PlacedThread, placeThreads, relocate, revealedLine } from "@/comments/comment-anchor.ts";
import { CommentThreadBox } from "@/comments/comment-box.tsx";
import { type ProjectComments, useCommentThreads } from "@/comments/project-comments.ts";
import { type PlacedDraft, useCommentDrafts } from "@/comments/use-comment-drafts.ts";
import { Button } from "@/components/ui/button";
import { useRenderVersion } from "@/hooks/use-render-version.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useTheme } from "@/theme.tsx";
import type { ChangeTarget } from "./change-target.ts";
import { diffLineCount, diffLines } from "./diff-lines.ts";
import { DIFF_COMMENT_CSS } from "./diff-plain-annotations.ts";

type Side = "additions" | "deletions";

/** Local reading intent outlives a temporarily released changes service, not its replicated file list. */
export interface DiffReadingState {
  positions: Map<string, number>;
  revealed: WeakSet<ChangeTarget>;
}

/** What is written on a line of the diff: a thread or an independently identified pending draft. */
type Annotation = { kind: "thread"; thread: CommentThread } | { kind: "draft"; draft: PlacedDraft };

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
  const { openFile } = useWorkbench();
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
  const orphaned = drafts.detached.length > 0 && (
    <div className="max-h-1/2 shrink-0 overflow-auto border-b">
      {drafts.detached.map((draft) => (
        <AnchoredCommentEditor
          key={draft.record.id}
          draft={draft}
          store={drafts.store}
          comments={comments}
          view={box}
        />
      ))}
    </div>
  );
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
  const startDraft = useCallback(
    (side: Side, line: number): void => {
      if (files[0] === undefined) return;
      drafts.start(side, line);
    },
    [files, drafts],
  );

  const options: CodeViewProps<Annotation, undefined>["options"] = useMemo(
    () => ({
      theme: { dark: "github-dark", light: "github-light" },
      themeType: choice,
      unsafeCSS: DIFF_COMMENT_CSS,
      diffStyle: style,
      disableFileHeader: true,
      overflow: wrap ? "wrap" : "scroll",
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
      {detached.length > 0 && (
        <div className="max-h-1/2 shrink-0 overflow-auto border-b">
          {verifying && (
            <p role="status" className="p-2 text-xs">
              Checking comment locations…
            </p>
          )}
          {verificationFailure !== null && (
            <div role="alert" className="p-2 text-sm">
              <p>Could not verify comment locations: {verificationFailure}</p>
              <Button size="sm" variant="outline" onClick={retryVerification}>
                Retry location check
              </Button>
            </div>
          )}
          {detached.map(({ thread, line, reason }) => (
            <div key={thread.id} data-detached-thread={thread.id}>
              <CommentThreadBox thread={thread} comments={comments} detached={reason} />
              {reason !== "outdated" && thread.anchor.side !== "deletions" && (
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
      <div ref={box} className="relative min-h-0 flex-1">
        <CodeView
          onScroll={(top) => {
            if (restored.current) reading?.positions.set(path, top);
          }}
          ref={view}
          className="h-full overflow-auto text-xs"
          items={items}
          options={options}
          renderAnnotation={(annotation) => {
            const written = annotation.metadata;
            if (written === undefined) return null;
            if (written.kind === "draft") {
              return (
                <AnchoredCommentEditor
                  key={written.draft.record.id}
                  draft={written.draft}
                  store={drafts.store}
                  comments={comments}
                  view={box}
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

/** Only verified file matches are outside; absent patch context alone proves nothing about an anchor. */
function useDetachedThreads(workspaceId: number, path: string, patchText: string, placed: readonly PlacedThread[]) {
  const { files } = useConnected();
  const missing = placed.filter((entry) => entry.line === undefined);
  const needsFile = missing.some(({ thread }) => thread.anchor.side !== "deletions");
  const key = useMemo(() => ({ files, workspaceId, path, patchText }), [files, workspaceId, path, patchText]);
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<{
    key: typeof key;
    attempt: number;
    result: { status: "ready"; lines: string[] } | { status: "error"; message: string };
  } | null>(null);
  useEffect(() => {
    if (!needsFile) return;
    let cancelled = false;
    files.read({ workspaceId, path }, BACKGROUND_CONTEXT).then(
      (content) => {
        if (cancelled) return;
        if (content.kind !== "text") {
          setFile({
            key,
            attempt,
            result: {
              status: "error",
              message: content.kind === "binary" ? "The file is not text." : "The file is too large to verify.",
            },
          });
          return;
        }
        const body = content.text.endsWith("\n") ? content.text.slice(0, -1) : content.text;
        setFile({ key, attempt, result: { status: "ready", lines: body.split("\n") } });
      },
      (error: unknown) => {
        if (!cancelled)
          setFile({
            key,
            attempt,
            result: { status: "error", message: error instanceof Error ? error.message : String(error) },
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, workspaceId, path, key, needsFile, attempt]);
  const result = file?.key === key && file.attempt === attempt ? file.result : undefined;
  const lines = result?.status === "ready" ? result.lines : undefined;
  const index = useMemo(
    () => (lines === undefined ? new Map<string, number[]>() : indexLines((line) => lines[line - 1], lines.length)),
    [lines],
  );
  const threads: (PlacedThread & { reason: "outdated" | "outside" | "unverified" })[] = missing.map(({ thread }) => {
    // We have no old-file snapshot with which to verify a deletion-side anchor.
    if (thread.anchor.side === "deletions" || lines === undefined)
      return { thread, line: undefined, reason: "unverified" };
    const line = relocate(thread.anchor, (line) => lines[line - 1], lines.length, index.get(thread.anchor.quote) ?? []);
    return { thread, line, reason: line === undefined ? "outdated" : "outside" };
  });
  return {
    threads,
    pending: needsFile && result === undefined,
    failure: needsFile && result?.status === "error" ? result.message : null,
    retry: () => setAttempt((current) => current + 1),
  };
}
