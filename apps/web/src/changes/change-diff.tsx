import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewDiffItem, type CodeViewHandle, type DiffLineAnnotation } from "@pierre/diffs/react";
import type { FilePatch } from "@tandem/contracts";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CommentDraft, CommentNote } from "@/comments/comment-box.tsx";
import { type CommentDrafts, useCommentDrafts } from "@/comments/comment-drafts.ts";
import type { LineComment } from "@/comments/line-comment.ts";
import { useTheme } from "@/theme.tsx";
import type { ChangeTarget } from "./change-target.ts";
import { diffQuote } from "./diff-quote.ts";
import { useHoveredLine } from "./hovered-line.ts";

type Side = "additions" | "deletions";

/** A line of the diff being commented on. */
interface Draft {
  side: Side;
  line: number;
  quote: string;
}

/** What is written on a line of the diff: a comment of the review, or the one being written. */
type Annotation = { kind: "comment"; comment: LineComment } | { kind: "draft"; draft: Draft };

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
  comments: CommentDrafts;
  /** A place of this file asked for, which the diff scrolls to. */
  reveal?: ChangeTarget;
}) {
  const { choice } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const hovered = useHoveredLine(box);
  const text = patch.kind === "patch" ? patch.patch : "";
  const written = useCommentDrafts(comments).filter((comment) => comment.path === path);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The renderer keeps the item it has until its version changes, and it cannot see a comment change by itself.
  const version = comments.revision * 2 + (draft === null ? 0 : 1);

  const files = useMemo(() => (text.trim() === "" ? [] : parsePatchFiles(text).flatMap((file) => file.files)), [text]);
  const items = useMemo<CodeViewDiffItem<Annotation>[]>(() => {
    const annotations: DiffLineAnnotation<Annotation>[] = written.map((comment) => ({
      side: comment.side ?? "additions",
      lineNumber: comment.line,
      metadata: { kind: "comment", comment },
    }));
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
  }, [path, text, version, files, written, draft]);

  // Scroll to the place that was asked for, once, as soon as the patch is rendered and can be scrolled.
  const revealed = useRef<ChangeTarget | null>(null);
  useEffect(() => {
    const item = items[0];
    if (reveal === undefined || reveal.path !== path || reveal.line === undefined) return;
    if (item === undefined || revealed.current === reveal) return;
    revealed.current = reveal;
    view.current?.scrollTo({
      type: "line",
      id: item.id,
      lineNumber: reveal.line,
      side: reveal.side ?? "additions",
      align: "center",
    });
  }, [reveal, items, path]);

  /** Write a comment on a line, with the line's text kept as what the note is about. A patch holds one file. */
  const startDraft = (side: Side, line: number): void => {
    const fileDiff = files[0];
    if (fileDiff === undefined) return;
    setDraft({ side, line, quote: diffQuote(fileDiff, side, line) ?? "" });
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
      written.some((comment) => comment.line === hovered.line && (comment.side ?? "additions") === hovered.side));
  return (
    <div ref={box} className="relative h-full min-h-0">
      {/* The line the pointer is on, where a code host shows it: beside the number, half over the code. */}
      {hovered !== null && !taken && (
        <button
          type="button"
          aria-label={`Comment on line ${hovered.line}`}
          className="absolute z-10 flex w-5 items-center justify-center rounded bg-primary text-primary-foreground"
          style={{ top: hovered.top, left: hovered.right - 14, height: hovered.height }}
          onClick={() => startDraft(hovered.side, hovered.line)}
        >
          <PlusIcon className="size-3.5" />
        </button>
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
                onSave={(text) => {
                  comments.add({ path, side: draft.side, line: draft.line, quote: draft.quote, text });
                  setDraft(null);
                }}
                onCancel={() => setDraft(null)}
              />
            );
          }
          return (
            <CommentNote
              comment={written.comment}
              onSave={(text) => comments.update(written.comment.id, text)}
              onRemove={() => comments.remove(written.comment.id)}
            />
          );
        }}
      />
    </div>
  );
}
