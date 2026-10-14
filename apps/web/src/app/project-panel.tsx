import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { EyeIcon, EyeOffIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { panelTabOf, useWorkbench } from "@/app/workbench.tsx";
import { ChangesView } from "@/changes/changes-view.tsx";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTree } from "@/files/file-tree.tsx";
import { FileView } from "@/files/file-view.tsx";
import { useProjectFiles } from "@/files/project-files.ts";
import { PreviewView } from "@/preview/preview-view.tsx";
import { useProjectChanges, useProjectChangesFailure } from "@/rpc/use-project-changes.ts";
import { TerminalsView } from "@/terminals/terminals-view.tsx";

/**
 * The panel beside the conversation, with a tab per view of its project. Files: the tree, and under it the opened file,
 * both read from disk when they open and when the user refreshes. Changes: what differs from the project's integration
 * branch, followed as the files on disk change. Terminal: the project's shells, which run on the server.
 */
export function ProjectPanel({
  workspaceId,
  active = true,
  onClose,
}: {
  workspaceId: number;
  active?: boolean;
  onClose?: () => void;
}) {
  const workbench = useWorkbench();
  const { panelTab, showTab, changeTarget, showHiddenFiles = false, setShowHiddenFiles } = workbench;
  const files = workbench.projectFiles(workspaceId);
  const comments = workbench.comments(workspaceId);
  const changes = useProjectChanges(workspaceId);
  const changesFailure = useProjectChangesFailure(workspaceId);
  const failure = useProjectFiles(files, (current) => current.failure);
  const opened = useProjectFiles(files, (current) => current.opened !== null);

  useEffect(() => {
    if (failure !== null) {
      toast.error("Cannot list a directory", { description: failure });
      files.dismissFailure();
    }
  }, [failure, files]);

  return (
    <Tabs value={panelTab} onValueChange={(value) => showTab(panelTabOf(value))} className="h-full min-h-0 gap-0">
      {/* As tall as the conversation's header beside it, so that their borders line up. */}
      <header className="flex h-13 shrink-0 items-center gap-1 border-b px-3">
        <TabsList variant="line">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        {/* A terminal draws itself as the shell writes: there is nothing to read again. */}
        <div className="ml-auto flex items-center gap-1">
          {panelTab === "files" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
                    aria-pressed={showHiddenFiles}
                    className={showHiddenFiles ? "text-foreground" : undefined}
                    onClick={() => setShowHiddenFiles?.(!showHiddenFiles)}
                  />
                }
              >
                {showHiddenFiles ? <EyeIcon /> : <EyeOffIcon />}
              </TooltipTrigger>
              <TooltipContent>{showHiddenFiles ? "Hide hidden files" : "Show hidden files"}</TooltipContent>
            </Tooltip>
          )}
          {panelTab !== "terminal" && panelTab !== "preview" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Refresh"
                    onClick={() => (panelTab === "files" ? files.refresh() : changes?.refresh(BACKGROUND_CONTEXT))}
                  />
                }
              >
                <RotateCwIcon />
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          )}
          {onClose && (
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          )}
        </div>
      </header>
      <TabsContent value="files" className="flex min-h-0 flex-col">
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel id="tree" minSize={80} className="overflow-auto p-2">
            <FileTree files={files} showHidden={showHiddenFiles} />
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
        <TerminalsView workspaceId={workspaceId} active={active && panelTab === "terminal"} />
      </TabsContent>
      {/* Kept mounted, so the preview iframe keeps its page state while another tab shows. */}
      <TabsContent value="preview" keepMounted className="flex min-h-0 flex-1 flex-col">
        <PreviewView active={active && panelTab === "preview"} />
      </TabsContent>
    </Tabs>
  );
}
