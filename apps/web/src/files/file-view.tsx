import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { FileContent } from "@tandem/contracts";
import { AlertCircleIcon, FileIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HighlightedLine, languageOfFile, useHighlighted } from "@/chat/highlight.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useConnected } from "@/rpc/connection.tsx";

/** Highlighting a longer file would hold up the page for a second or more; it shows as plain text instead. */
const MAX_HIGHLIGHTED_LINES = 3000;

/** One file of a project, read when it opens and on each refresh, shown at a line if one is asked for. */
export function FileView({
  workspaceId,
  path,
  line,
  request,
  refresh,
  onClose,
}: {
  workspaceId: number;
  path: string;
  line: number | undefined;
  /** Changes with each request to show the file, so the line is shown again. */
  request: number;
  /** Changes when the file should be read again. */
  refresh: number;
  onClose(): void;
}) {
  const { files } = useConnected();
  const [read, setRead] = useState<{ path: string; content?: FileContent; error?: string } | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` and `request` ask for the file to be read again.
  useEffect(() => {
    let current = true;
    files.read({ workspaceId, path }, BACKGROUND_CONTEXT).then(
      (content) => current && setRead({ path, content }),
      (error: unknown) => current && setRead({ path, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [files, workspaceId, path, refresh, request]);

  const shown = read?.path === path ? read : undefined;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`File ${path}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-y px-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {path}
        </p>
        {shown?.content !== undefined && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatSize(shown.content.size)}</span>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Close the file" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {shown === undefined ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <Spinner />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : shown.error !== undefined ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Cannot open the file</AlertTitle>
              <AlertDescription>{shown.error}</AlertDescription>
            </Alert>
          </div>
        ) : shown.content?.kind === "text" ? (
          <FileText text={shown.content.text} name={path} line={line} request={request} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileIcon />
              </EmptyMedia>
              <EmptyTitle>{shown.content?.kind === "binary" ? "Binary file" : "Too large to show"}</EmptyTitle>
              <EmptyDescription>
                {shown.content?.kind === "binary"
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

/** The text with line numbers, highlighted unless it is long; the asked-for line is marked and scrolled to. */
function FileText({ text, name, line, request }: { text: string; name: string; line?: number; request: number }) {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = body.split("\n");
  const language =
    lines.length <= MAX_HIGHLIGHTED_LINES ? languageOfFile(name.slice(name.lastIndexOf("/") + 1)) : undefined;
  const tokens = useHighlighted(body, language, false);
  const scroller = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each request shows the line again, and so does new text.
  useEffect(() => {
    if (line === undefined) return;
    scroller.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: "center" });
  }, [line, request, text]);

  return (
    <div ref={scroller} className="h-full overflow-auto">
      <pre className="w-max min-w-full py-2 font-mono text-xs leading-relaxed">
        <code>
          {lines.map((content, index) => {
            const number = index + 1;
            return (
              <div key={number} data-line={number} className={cn("flex", number === line && "bg-primary/10")}>
                <span className="sticky left-0 w-12 shrink-0 bg-background pr-4 text-right text-muted-foreground select-none">
                  {number}
                </span>
                {tokens?.[index] === undefined ? (
                  <span className="pr-4">{content}</span>
                ) : (
                  <HighlightedLine tokens={tokens[index]} className="pr-4" />
                )}
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
