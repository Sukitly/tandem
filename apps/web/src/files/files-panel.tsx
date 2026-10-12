import { AlertCircleIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useWorkbench } from "@/app/workbench.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTree } from "./file-tree.tsx";
import { FileView } from "./file-view.tsx";
import { useProjectFiles } from "./project-files.ts";

/**
 * The panel beside the conversation, with a tab per view of its project; for now, Files: the tree, and under it the
 * opened file. Both are read from disk when they open and when the user refreshes; they do not follow changes by
 * themselves.
 */
export function FilesPanel({ workspaceId }: { workspaceId: number }) {
  const files = useWorkbench().projectFiles(workspaceId);
  const failure = useProjectFiles(files, (current) => current.failure);
  const opened = useProjectFiles(files, (current) => current.opened !== null);

  return (
    <Tabs defaultValue="files" className="h-full min-h-0 gap-0">
      {/* As tall as the conversation's header beside it, so that their borders line up. */}
      <header className="flex h-13 shrink-0 items-center gap-1 border-b px-3">
        <TabsList variant="line">
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Refresh"
                className="ml-auto"
                onClick={() => files.refresh()}
              />
            }
          >
            <RotateCwIcon />
          </TooltipTrigger>
          <TooltipContent>Read the files again</TooltipContent>
        </Tooltip>
      </header>
      <TabsContent value="files" className="flex min-h-0 flex-col">
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
      </TabsContent>
    </Tabs>
  );
}
