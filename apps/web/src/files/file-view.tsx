import { AlertCircleIcon, FileIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { UnverifiedCommentDrafts } from "@/comments/anchored-comment-editor.tsx";
import type { ProjectComments } from "@/comments/project-comments.ts";
import {
  Reader,
  ReaderBody,
  ReaderCloseButton,
  ReaderExpandButton,
  ReaderHeader,
  ReaderPath,
} from "@/components/reader.tsx";
import { ReaderWrapButton } from "@/components/reader-surface.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { preferences } from "@/lib/preferences.ts";
import { FileText } from "./file-text.tsx";
import { type ProjectFiles, useProjectFiles } from "./project-files.ts";

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = text.endsWith("\n") ? 0 : 1;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) count += 1;
  return count;
}

export function formatLines(count: number): string {
  return `${count.toLocaleString()} L`;
}

/** The opened file of the files panel, shown at its line if one was asked for. */
export function FileView({
  files,
  comments,
  active = true,
}: {
  files: ProjectFiles;
  comments: ProjectComments;
  active?: boolean;
}) {
  const opened = useProjectFiles(files, (current) => current.opened);
  const content = useProjectFiles(files, (current) => current.content);
  const lineCount = useMemo(
    () => (content?.status === "ready" && content.value.kind === "text" ? countLines(content.value.text) : 0),
    [content],
  );
  const [wrap, setWrap] = useState(() => preferences.getItem("tandem.fileWrap") === "true");
  const toggleWrap = (): void => {
    setWrap(!wrap);
    preferences.setItem("tandem.fileWrap", String(!wrap));
  };

  if (opened === null) return null;
  return (
    <Reader active={active} label={`File ${opened.path}`}>
      <ReaderHeader>
        <ReaderPath path={opened.path} />
        {content?.status === "ready" && content.value.kind === "text" && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatLines(lineCount)}</span>
        )}
        <ReaderWrapButton wrap={wrap} onToggle={toggleWrap} />
        <ReaderExpandButton />
        <ReaderCloseButton label="Close the file" onClose={() => files.close()} />
      </ReaderHeader>
      <ReaderBody>
        {(content?.status !== "ready" || content.value.kind !== "text") && (
          <UnverifiedCommentDrafts path={opened.path} comments={comments} />
        )}
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
          <FileText key={opened.path} text={content.value.text} opened={opened} comments={comments} wrap={wrap} />
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
      </ReaderBody>
    </Reader>
  );
}
