import { CodeView, type CodeViewFileItem, type CodeViewHandle, type CodeViewProps } from "@pierre/diffs/react";
import type { CommentThread } from "@tandem/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { DIFF_COMMENT_CSS } from "@/changes/diff-plain-annotations.ts";
import { AnchoredCommentEditor } from "@/comments/anchored-comment-editor.tsx";
import type { PlacedThread } from "@/comments/comment-anchor.ts";
import { CommentThreadBox } from "@/comments/comment-box.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import type { PlacedDraft, useCommentDrafts } from "@/comments/use-comment-drafts.ts";
import { CodeCopyButton } from "@/components/copy-text.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";
import { useRenderVersion } from "@/hooks/use-render-version.ts";
import { useTheme } from "@/theme.tsx";
import type { OpenedFile } from "./project-files.ts";

type Annotation = { kind: "thread"; thread: CommentThread } | { kind: "draft"; draft: PlacedDraft };

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
  const [input, setInput] = useState("1");
  const inputId = useId();
  const composition = useCompositionGuard();
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<number | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const target = Number(input);
  const valid = Number.isSafeInteger(target) && target >= 1 && target <= lines.length;
  const version = useRenderVersion([text, placed, drafts.placed]);
  const items = useMemo<CodeViewFileItem<Annotation>[]>(
    () => [
      {
        id: path,
        type: "file",
        version,
        file: { name: path, contents: text, lang: "text" },
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
    [path, text, placed, drafts.placed, version],
  );

  const go = (number: number): void => {
    view.current?.scrollTo({ type: "line", id: path, lineNumber: number, align: "center" });
    view.current?.setSelectedLines({ id: path, range: { start: number, end: number } });
  };
  const findNext = (): void => {
    if (query === "") return;
    const needle = query.toLowerCase();
    for (let offset = 0; offset < lines.length; offset += 1) {
      const index = ((match === null ? 0 : match + 1) + offset) % lines.length;
      if (!lines[index]?.toLowerCase().includes(needle)) continue;
      setMatch(index);
      setInput(String(index + 1));
      setSearchStatus(`Found on line ${index + 1}`);
      go(index + 1);
      return;
    }
    setMatch(null);
    setSearchStatus("No matching line");
  };
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

  const onLineNumberClick = useCallback(
    ({ lineNumber }: { lineNumber: number }): void => {
      setInput(String(lineNumber));
      drafts.start("additions", lineNumber);
    },
    [drafts],
  );

  const options: CodeViewProps<Annotation, undefined>["options"] = useMemo(
    () => ({
      theme: { dark: "github-dark", light: "github-light" },
      themeType: choice,
      disableFileHeader: true,
      overflow: wrap ? "wrap" : "scroll",
      unsafeCSS: DIFF_COMMENT_CSS,
      lineHoverHighlight: "both",
      onLineNumberClick,
    }),
    [choice, wrap, onLineNumberClick],
  );

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col" data-virtual-file>
      <form
        className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !composition.active()) go(target);
        }}
      >
        <label htmlFor={inputId}>Line</label>
        <Input
          id={inputId}
          type="number"
          min={1}
          max={lines.length}
          required
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="w-24"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!valid}>
          Go to line
        </Button>
        <CodeCopyButton value={text} aria-label="Copy entire file" />
        <Input
          type="search"
          aria-label="Search file"
          placeholder="Search file"
          value={query}
          className="w-40"
          onChange={(event) => {
            setQuery(event.target.value);
            setMatch(null);
            setSearchStatus(null);
          }}
          onCompositionStart={composition.onCompositionStart}
          onCompositionEnd={composition.onCompositionEnd}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !composition.owns(event)) {
              event.preventDefault();
              findNext();
            }
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={query === ""} onClick={findNext}>
          Find next line
        </Button>
        {searchStatus !== null && <span role="status">{searchStatus}</span>}
        <p className="w-full text-muted-foreground">
          Large file: only nearby lines are rendered. Search here, jump to a line, or copy the entire file.
        </p>
      </form>
      {drafts.detached.length > 0 && (
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
      )}
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
  );
}
