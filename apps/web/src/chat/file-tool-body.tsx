import { File, PatchDiff } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block.tsx";
import { useTheme } from "@/theme.tsx";
import { ToolDiff } from "./tool-diff.tsx";
import type { AssistantPart } from "./transcript.ts";

type ToolPart = Extract<AssistantPart, { kind: "tool" }>;

/** Whether the call changes a file, so that its transcript step shows the change instead of the raw arguments. */
export function isFileTool(step: ToolPart): boolean {
  return step.name === "edit" || step.name === "write";
}

/**
 * What an `edit` or `write` step shows when expanded: for `edit`, the diff of the change it made; for `write`, the
 * content it wrote. `undefined` when there is nothing to show yet. A failed call also shows its error.
 */
export function fileToolBody(step: ToolPart): ReactNode | undefined {
  const change = changeOf(step);
  const message = step.output !== "" && (change === undefined || step.status === "failed") ? step.output : undefined;
  if (change === undefined && message === undefined) return undefined;
  return (
    <div className="grid min-w-0 gap-2">
      {change}
      {message !== undefined && (
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-64">
            {message}
          </CodeBlockContent>
        </CodeBlock>
      )}
    </div>
  );
}

function changeOf(step: ToolPart): ReactNode | undefined {
  if (step.name === "edit") {
    if (step.patch !== undefined) return <ToolPatch patch={step.patch} />;
    // Results recorded before the patch was kept hold only the diff.
    if (step.diff !== undefined) return <ToolDiff diff={step.diff} />;
    return undefined;
  }
  const { path, content } = step.args;
  if (step.name === "write" && typeof path === "string" && typeof content === "string") {
    return <ToolFile path={path} content={content} />;
  }
  return undefined;
}

const BOX = "max-h-80 min-w-0 overflow-auto rounded-lg border border-border/70 text-xs";

/** An edit's change as a patch, drawn the way the Changes panel draws a file's diff. */
function ToolPatch({ patch }: { patch: string }) {
  const { choice } = useTheme();
  return (
    <div className={BOX}>
      <PatchDiff
        patch={patch}
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: choice,
          diffStyle: "unified",
          disableFileHeader: true,
          overflow: "scroll",
        }}
      />
    </div>
  );
}

/** What a write put in the file, highlighted by the file's extension. */
function ToolFile({ path, content }: { path: string; content: string }) {
  const { choice } = useTheme();
  return (
    <div className={BOX}>
      <File
        file={{ name: path, contents: content }}
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: choice,
          disableFileHeader: true,
          overflow: "scroll",
        }}
      />
    </div>
  );
}
