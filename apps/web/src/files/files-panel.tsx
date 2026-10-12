import { AlertCircleIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useWorkbench } from "@/app/workbench.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { FileTree } from "./file-tree.tsx";
import { FileView } from "./file-view.tsx";
import { useProjectFiles } from "./project-files.ts";

/**
 * The current project's files: the tree, and under it the opened file. Both are read from disk when they open and
 * when the user refreshes; they do not follow changes by themselves.
 */
export function FilesPanel({ workspaceId }: { workspaceId: number }) {
  const { workspaces } = useConnected();
  const project = useReplicatedState(workspaces.state)?.workspaces.find((candidate) => candidate.id === workspaceId);
  const files = useWorkbench().projectFiles(workspaceId);
  const failure = useProjectFiles(files, (current) => current.failure);
  const opened = useProjectFiles(files, (current) => current.opened !== null);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Files">
      {/* As tall as the conversation's header beside it, so that their borders line up. */}
      <header className="flex h-13 shrink-0 items-center gap-1 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate font-mono text-xs" title={project?.path}>
          {project?.path}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label="Refresh" onClick={() => files.refresh()} />}
          >
            <RotateCwIcon />
          </TooltipTrigger>
          <TooltipContent>Read the files again</TooltipContent>
        </Tooltip>
      </header>
      {failure !== null && (
        <div className="p-2">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Cannot list a directory</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
            <AlertAction>
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => files.dismissFailure()}>
                <XIcon />
              </Button>
            </AlertAction>
          </Alert>
        </div>
      )}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="tree" minSize={80} className="overflow-auto p-2">
          <FileTree files={files} />
        </ResizablePanel>
        {opened && (
          <>
            <ResizableHandle />
            <ResizablePanel id="file" defaultSize="60" minSize={120}>
              <FileView files={files} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </section>
  );
}
