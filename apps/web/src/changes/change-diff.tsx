import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewDiffItem, type CodeViewHandle, type DiffLineAnnotation } from "@pierre/diffs/react";
import type { CommentThread, FilePatch } from "@tandem/contracts";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { anchorAt, type PlacedThread, placeThreads, relocate } from "@/comments/comment-anchor.ts";
import { CommentDraft, CommentThreadBox } from "@/comments/comment-box.tsx";
import { type ProjectComments, useCommentThreads } from "@/comments/project-comments.ts";
import { Button } from "@/components/ui/button";
import { useConnected } from "@/rpc/connection.tsx";
import { useTheme } from "@/theme.tsx";
import type { ChangeTarget } from "./change-target.ts";
import { diffLine, diffLineCount } from "./diff-lines.ts";
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
  comments,
  reveal,
}: {
  path: string;
  patch: FilePatch;
  style: "split" | "unified";
  comments: ProjectComments;
  /** A place of this file asked for, which the diff scrolls to. */
  reveal?: ChangeTarget;
}) {
  const { choice } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const hovered = useHoveredLine(box);
  const text = patch.kind === "patch" ? patch.patch : "";
  const threads = useCommentThreads(comments);
  const [draft, setDraft] = useState<Draft | null>(null);

  const files = useMemo(() => (text.trim() === "" ? [] : parsePatchFiles(text).flatMap((file) => file.files)), [text]);
  // Each thread on the line its text is on now, on its side of the diff; one whose line the patch does not show is
  // looked for in the file (`useOutdatedThreads`).
  const placed = useMemo<PlacedThread[]>(() => {
    const fileDiff = files[0];
    if (fileDiff === undefined) return [];
    return (["additions", "deletions"] as const).flatMap((side) =>
      placeThreads(threads, path, side, (line) => diffLine(fileDiff, side, line), diffLineCount(fileDiff, side)),
    );
  }, [files, threads, path]);
  const outdated = useOutdatedThreads(comments.workspaceId, path, text, placed);
  // The renderer keeps the item it has until its version changes, and it cannot see a thread change by itself.
  const version = useMemo(() => versionOf(placed, draft), [placed, draft]);

  const items = useMemo<CodeViewDiffItem<Annotation>[]>(() => {
    const annotations: DiffLineAnnotation<Annotation>[] = placed.flatMap(({ thread, line }) =>
      line === undefined
        ? []
        : [{ side: thread.anchor.side ?? "additions", lineNumber: line, metadata: { kind: "thread", thread } }],
    );
    if (draft !== null) {
      annotations.push({ side: draft.side, lineNumber: draft.line, metadata: { kind: "draft", draft } });
    }
    // The patch itself is part of the item's identity: a rewritten patch is rendered, not taken for the one before it.
    return files.map((fileDiff, index) => ({
      id: `${path}#${text.length}#${index}`,
      type: "diff",
      fileDiff,
      annotations,
      version,
    }));
  }, [path, text, version, files, placed, draft]);

  // Scroll to the place that was asked for, once, as soon as the patch is rendered and can be scrolled.
  const revealed = useRef<ChangeTarget | null>(null);
  useEffect(() => {
    const item = items[0];
    if (reveal === undefined || reveal.path !== path || reveal.line === undefined) return;
    if (item === undefined || revealed.current === reveal) return;
    revealed.current = reveal;
    // A thread has moved with its line, or is outdated and shown above the diff, where the line it had is no help.
    const thread = placed.find((entry) => entry.thread.id === reveal.threadId);
    view.current?.scrollTo({
      type: "line",
      id: item.id,
      lineNumber: thread?.line ?? reveal.line,
      side: reveal.side ?? "additions",
      align: "center",
    });
  }, [reveal, items, path, placed]);

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
      {outdated.length > 0 && (
        <div className="max-h-1/2 shrink-0 overflow-auto border-b">
          {outdated.map(({ thread }) => (
            <CommentThreadBox key={thread.id} thread={thread} comments={comments} outdated />
          ))}
        </div>
      )}
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
            diffStyle: style,
            disableFileHeader: true,
            overflow: "scroll",
            // Clicking a line's number writes a comment on it too. The library's own hover button is left off: its button
            // and the row it marks belong to the item, and a comment arriving re-renders the item, which strands both on
            // the row they were on.
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
 * The threads whose line is gone. A diff shows only its hunks, so a thread missing from it may only be on a line the
 * patch leaves out: the file as it is is read, and a thread on the new file is outdated only if its line is not there
 * either. A thread on a removed line has no other file to look in: missing from the diff, it is outdated.
 *
 * The file is read again when the patch changes, since the file changed with it; until it is read, a thread that may
 * still be there is not shown.
 */
function useOutdatedThreads(
  workspaceId: number,
  path: string,
  patchText: string,
  placed: readonly PlacedThread[],
): PlacedThread[] {
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
      // An unreadable file has no lines to find: a thread missing from the diff is outdated then.
      () => {
        if (!cancelled) setFile({ key, lines: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, workspaceId, path, key, needsFile]);

  const lines = file?.key === key ? file.lines : undefined;
  return missing.filter(({ thread }) => {
    if (thread.anchor.side === "deletions") return true;
    if (lines === undefined) return false;
    return lines === null || relocate(thread.anchor, (line) => lines[line - 1], lines.length) === undefined;
  });
}

/**
 * A number that changes whenever what is written on the diff does: the threads, where they are, and the one being
 * started. The renderer redraws an item only when its version changes.
 */
function versionOf(placed: readonly PlacedThread[], draft: Draft | null): number {
  const key = JSON.stringify([placed.map(({ thread, line }) => [line, thread]), draft]);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  return hash;
}
