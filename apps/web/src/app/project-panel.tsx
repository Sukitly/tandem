import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AlertCircleIcon, RotateCwIcon, XIcon } from "lucide-react";
import { panelTabOf, useWorkbench } from "@/app/workbench.tsx";
import { ChangesView } from "@/changes/changes-view.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTree } from "@/files/file-tree.tsx";
import { FileView } from "@/files/file-view.tsx";
import { useProjectFiles } from "@/files/project-files.ts";
import { useProjectChanges, useProjectChangesFailure } from "@/rpc/use-project-changes.ts";
import { TerminalsView } from "@/terminals/terminals-view.tsx";

/**
 * The panel beside the conversation, with a tab per view of its project. Files: the tree, and under it the opened file,
 * both read from disk when they open and when the user refreshes. Changes: what differs from the project's integration
 * branch, followed as the files on disk change. Terminal: the project's shells, which run on the server.
 */
export function ProjectPanel({ workspaceId }: { workspaceId: number }) {
  const workbench = useWorkbench();
  const { panelTab, showTab, changeTarget } = workbench;
  const files = workbench.projectFiles(workspaceId);
  const comments = workbench.comments(workspaceId);
  const changes = useProjectChanges(workspaceId);
  const changesFailure = useProjectChangesFailure(workspaceId);
  const failure = useProjectFiles(files, (current) => current.failure);
  const opened = useProjectFiles(files, (current) => current.opened !== null);
  return (
    <Tabs value={panelTab} onValueChange={(value) => showTab(panelTabOf(value))} className="h-full min-h-0 gap-0">
      {/* As tall as the conversation's header beside it, so that their borders line up. */}
      <header className="flex h-13 shrink-0 items-center gap-1 border-b px-3">
        <TabsList variant="line">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>
        {/* A terminal draws itself as the shell writes: there is nothing to read again. */}
        {panelTab !== "terminal" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refresh"
                  className="ml-auto"
                  onClick={() => (panelTab === "files" ? files.refresh() : changes?.refresh(BACKGROUND_CONTEXT))}
                />
              }
            >
              <RotateCwIcon />
            </TooltipTrigger>
            <TooltipContent>Read again</TooltipContent>
          </Tooltip>
        )}
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
                <FileView files={files} comments={comments} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </TabsContent>
      <TabsContent value="changes" className="flex min-h-0 flex-col">
        <ChangesView
          changes={changes}
          failure={changesFailure}
          comments={comments}
          reveal={changeTarget?.workspaceId === workspaceId ? changeTarget : undefined}
        />
      </TabsContent>
      {/* Kept mounted, so the terminals keep their screens and connections while another tab shows. */}
      <TabsContent value="terminal" keepMounted className="flex min-h-0 flex-col">
        <TerminalsView workspaceId={workspaceId} active={panelTab === "terminal"} />
      </TabsContent>
    </Tabs>
  );
}
