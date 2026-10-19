import { type ReactNode, Suspense } from "react";
import { LoadingView } from "@/components/loading-view.tsx";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block.tsx";
import { lazyExport } from "@/lib/lazy-export.ts";
import type { AssistantPart } from "./transcript.ts";

/** The views of a change draw with `@pierre/diffs`, which is loaded when the first one is drawn. */
const ToolPatch = lazyExport(() => import("./tool-code.tsx"), "ToolPatch");
const ToolFile = lazyExport(() => import("./tool-code.tsx"), "ToolFile");

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
    return step.patch === undefined ? undefined : (
      <Suspense fallback={<LoadingView />}>
        <ToolPatch patch={step.patch} />
      </Suspense>
    );
  }
  const { path, content } = step.args;
  if (step.name === "write" && typeof path === "string" && typeof content === "string") {
    return (
      <Suspense fallback={<LoadingView />}>
        <ToolFile path={path} content={content} />
      </Suspense>
    );
  }
  return undefined;
}
