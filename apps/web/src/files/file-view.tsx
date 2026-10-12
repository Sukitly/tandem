import { AlertCircleIcon, FileIcon, XIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { HighlightedLine, languageOfFile, useHighlighted } from "@/chat/highlight.tsx";
import { CommentDraft, CommentNote } from "@/comments/comment-box.tsx";
import { type CommentDrafts, useCommentDrafts } from "@/comments/comment-drafts.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatSize } from "./format-size.ts";
import { type OpenedFile, type ProjectFiles, useProjectFiles } from "./project-files.ts";

/** Highlighting a longer file would hold up the page for a second or more; it shows as plain text instead. */
const MAX_HIGHLIGHTED_LINES = 3000;

/** The opened file of the files panel, shown at its line if one was asked for. */
export function FileView({ files, comments }: { files: ProjectFiles; comments: CommentDrafts }) {
  const opened = useProjectFiles(files, (current) => current.opened);
  const content = useProjectFiles(files, (current) => current.content);
  if (opened === null) return null;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`File ${opened.path}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs" title={opened.path}>
          {opened.path}
        </p>
        {content?.status === "ready" && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatSize(content.value.size)}</span>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Close the file" onClick={() => files.close()}>
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
          <FileText text={content.value.text} opened={opened} comments={comments} />
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
    </section>
  );
}

/**
 * The text with line numbers, highlighted unless it is long; the asked-for line is marked and scrolled to. A comment
 * is written by clicking a line's number, and shown under the line it is about.
 */
function FileText({ text, opened, comments }: { text: string; opened: OpenedFile; comments: CommentDrafts }) {
  const { path, line } = opened;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = body.split("\n");
  const language =
    lines.length <= MAX_HIGHLIGHTED_LINES ? languageOfFile(path.slice(path.lastIndexOf("/") + 1)) : undefined;
  const tokens = useHighlighted(body, language, false);
  const scroller = useRef<HTMLDivElement>(null);
  const written = useCommentDrafts(comments).filter((comment) => comment.path === path);
  const [draft, setDraft] = useState<{ line: number; quote: string } | null>(null);

  // Each request to show a place is a new `opened`, so asking again for the same line shows it again.
  useEffect(() => {
    if (opened.line === undefined) return;
    scroller.current?.querySelector(`[data-line="${opened.line}"]`)?.scrollIntoView({ block: "center" });
  }, [opened]);

  return (
    <div ref={scroller} className="h-full overflow-auto">
      <pre className="w-max min-w-full py-2 font-mono text-xs leading-relaxed">
        <code>
          {lines.map((content, index) => {
            const number = index + 1;
            return (
              <Fragment key={number}>
                <div data-line={number} className={cn("group/line flex", number === line && "bg-primary/10")}>
                  <button
                    type="button"
                    aria-label={`Comment on line ${number}`}
                    title="Comment on this line"
                    className="sticky left-0 w-12 shrink-0 cursor-pointer bg-background pr-4 text-right text-muted-foreground select-none"
                    onClick={() => setDraft({ line: number, quote: content })}
                  >
                    <span className="group-hover/line:hidden">{number}</span>
                    <span className="hidden group-hover/line:inline">+</span>
                  </button>
                  {tokens?.[index] === undefined ? (
                    <span className="pr-4">{content}</span>
                  ) : (
                    <HighlightedLine tokens={tokens[index]} className="pr-4" />
                  )}
                </div>
                {written
                  .filter((comment) => comment.line === number)
                  .map((comment) => (
                    <CommentNote
                      key={comment.id}
                      comment={comment}
                      view={scroller}
                      className="ml-14"
                      onSave={(text) => comments.update(comment.id, text)}
                      onRemove={() => comments.remove(comment.id)}
                    />
                  ))}
                {draft?.line === number && (
                  <CommentDraft
                    place={`${path}:${draft.line}`}
                    view={scroller}
                    className="ml-14"
                    onSave={(text) => {
                      comments.add({ path, line: draft.line, quote: draft.quote, text });
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
