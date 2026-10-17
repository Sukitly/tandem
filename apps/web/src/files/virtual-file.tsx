import { CodeView, type CodeViewFileItem, type CodeViewHandle } from "@pierre/diffs/react";
import type { CommentThread } from "@tandem/contracts";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DIFF_COMMENT_CSS } from "@/changes/diff-plain-annotations.ts";
import { AnchoredCommentEditor } from "@/comments/anchored-comment-editor.tsx";
import type { PlacedThread } from "@/comments/comment-anchor.ts";
import { CommentThreadBox } from "@/comments/comment-box.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import type { useCommentDrafts } from "@/comments/use-comment-drafts.ts";
import { CodeCopyButton } from "@/components/copy-text.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";
import { useRenderVersion } from "@/hooks/use-render-version.ts";
import { useTheme } from "@/theme.tsx";
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
  const view = useRef<CodeViewHandle<CommentThread, undefined>>(null);
  const shown = useRef<OpenedFile | null>(null);
  const [input, setInput] = useState("1");
  const inputId = useId();
  const composition = useCompositionGuard();
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<number | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const target = Number(input);
  const valid = Number.isSafeInteger(target) && target >= 1 && target <= lines.length;
  const version = useRenderVersion([text, placed]);
  const items = useMemo<CodeViewFileItem<CommentThread>[]>(
    () => [
      {
        id: path,
        type: "file",
        version,
        file: { name: path, contents: text, lang: "text" },
        annotations: placed.flatMap(({ thread, line }) =>
          line === undefined ? [] : [{ lineNumber: line, metadata: thread }],
        ),
      },
    ],
    [path, text, placed, version],
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!valid}
          onClick={() => {
            go(target);
            drafts.start("additions", target);
          }}
        >
          Add comment
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
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: choice,
          disableFileHeader: true,
          overflow: wrap ? "wrap" : "scroll",
          unsafeCSS: DIFF_COMMENT_CSS,
          onLineNumberClick: ({ lineNumber }) => {
            setInput(String(lineNumber));
            drafts.start("additions", lineNumber);
          },
        }}
        renderAnnotation={(annotation) => (
          <CommentThreadBox thread={annotation.metadata} comments={comments} view={box} />
        )}
      />
      {drafts.placed.length > 0 && (
        <div className="max-h-[40%] shrink-0 overflow-auto border-t">
          {drafts.placed.map((draft) => (
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
    </div>
  );
}
