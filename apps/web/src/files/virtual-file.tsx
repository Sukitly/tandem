import { CodeView, type CodeViewFileItem, type CodeViewHandle, type CodeViewProps } from "@pierre/diffs/react";
import type { CommentThread } from "@tandem/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CODE_COMMENT_CSS } from "@/comments/code-comment-style.ts";
import type { PlacedThread } from "@/comments/comment-anchor.ts";
import {
  type CommentAnnotation as Annotation,
  CommentAnnotationView,
  CommentDraftList,
} from "@/comments/comment-annotations.tsx";
import { CommentThreadBox } from "@/comments/comment-box.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import type { useCommentDrafts } from "@/comments/use-comment-drafts.ts";
import { Button } from "@/components/ui/button";
import { useRenderVersion } from "@/hooks/use-render-version.ts";
import { useTheme } from "@/theme.tsx";
import { FileFinderBar, useFileFinder } from "./file-finder.tsx";
import type { OpenedFile } from "./project-files.ts";

/** Long files use the existing virtual renderer; the editor stays mounted even when its line scrolls away. */
export function VirtualFile({
  text,
  lines,
  opened,
  comments,
  placed,
  above,
  line,
  wrap,
  drafts,
}: {
  text: string;
  lines: readonly string[];
  opened: OpenedFile;
  comments: ProjectComments;
  placed: readonly PlacedThread[];
  above: readonly { thread: CommentThread; why: "outdated" | "removed" }[];
  line: number | undefined;
  wrap: boolean;
  drafts: ReturnType<typeof useCommentDrafts>;
}) {
  const { path } = opened;
  const { choice } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const shown = useRef<OpenedFile | null>(null);
  const version = useRenderVersion([text, placed, drafts.placed]);
  // The virtualizer prepares layout against this identity. Annotation changes are not new file contents.
  const file = useMemo(() => ({ name: path, contents: text, lang: "text" as const }), [path, text]);
  const items = useMemo<CodeViewFileItem<Annotation>[]>(
    () => [
      {
        id: path,
        type: "file",
        version,
        file,
        annotations: [
          ...placed.flatMap(({ thread, line }) =>
            line === undefined ? [] : [{ lineNumber: line, metadata: { kind: "thread" as const, thread } }],
          ),
          ...drafts.placed.flatMap((draft) =>
            draft.line === undefined ? [] : [{ lineNumber: draft.line, metadata: { kind: "draft" as const, draft } }],
          ),
        ],
      },
    ],
    [path, file, placed, drafts.placed, version],
  );

  const go = (number: number): void => {
    view.current?.scrollTo({ type: "line", id: path, lineNumber: number, align: "center" });
    view.current?.setSelectedLines({ id: path, range: { start: number, end: number } });
  };
  const finder = useFileFinder(lines, go);
  useEffect(() => {
    if (shown.current === opened) return;
    if (line !== undefined) {
      view.current?.scrollTo({ type: "line", id: path, lineNumber: line, align: "center" });
      view.current?.setSelectedLines({ id: path, range: { start: line, end: line } });
    } else if (opened.threadId !== undefined) {
      box.current?.querySelector(`[data-thread="${opened.threadId}"]`)?.scrollIntoView({ block: "nearest" });
    }
    shown.current = opened;
  }, [opened, path, line]);

  const startDraft = drafts.start;
  const onLineNumberClick = useCallback(
    ({ lineNumber }: { lineNumber: number }): void => {
      finder.setLine(String(lineNumber));
      startDraft("additions", lineNumber);
    },
    [startDraft, finder.setLine],
  );

  const options: CodeViewProps<Annotation, undefined>["options"] = useMemo(
    () => ({
      theme: { dark: "github-dark", light: "github-light" },
      themeType: choice,
      disableFileHeader: true,
      overflow: wrap ? "wrap" : "scroll",
      unsafeCSS: CODE_COMMENT_CSS,
      lineHoverHighlight: "both",
      onLineNumberClick,
    }),
    [choice, wrap, onLineNumberClick],
  );

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col" data-virtual-file>
      <FileFinderBar finder={finder} lineCount={lines.length} text={text} />
      <CommentDraftList entries={drafts.placed} drafts={drafts} comments={comments} view={box} />
      {above.length > 0 && (
        <div className="max-h-1/2 shrink-0 overflow-auto border-b">
          {above.map(({ thread, why }) => (
            <div key={thread.id} data-thread={thread.id}>
              <CommentThreadBox thread={thread} comments={comments} detached={why} view={box} />
            </div>
          ))}
        </div>
      )}
      <CodeView
        ref={view}
        className="min-h-0 flex-1 overflow-auto text-xs"
        items={items}
        options={options}
        renderAnnotation={(annotation) => {
          const entry = annotation.metadata;
          if (entry?.kind === "draft")
            return (
              <Button
                size="sm"
                variant="link"
                onClick={() => {
                  const editor = box.current?.querySelector<HTMLTextAreaElement>(
                    `[data-comment-draft="${entry.draft.record.id}"] textarea`,
                  );
                  editor?.focus({ preventScroll: true });
                  editor?.scrollIntoView({ block: "nearest" });
                }}
              >
                Edit comment on line {entry.draft.line}
              </Button>
            );
          return <CommentAnnotationView annotation={entry} drafts={drafts} comments={comments} view={box} />;
        }}
      />
    </div>
  );
}
