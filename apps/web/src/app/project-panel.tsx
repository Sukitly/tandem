import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  EyeIcon,
  EyeOffIcon,
  FilesIcon,
  GitCompareIcon,
  GlobeIcon,
  RotateCwIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
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
  const [refreshing, setRefreshing] = useState(false);
  const { panelTab, showTab, changeTarget, showHiddenFiles = false, setShowHiddenFiles } = workbench;
  const files = workbench.projectFiles(workspaceId);
  const comments = workbench.comments(workspaceId);
  // Retained projects create expensive tabs only after the user visits them.
  const [visited, setVisited] = useState(() => new Set([panelTab]));
  if (!visited.has(panelTab)) setVisited(new Set(visited).add(panelTab));
  const changes = useProjectChanges(workspaceId, active && visited.has("changes"));
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
    <Tabs
      value={panelTab}
      onValueChange={(value) => showTab(panelTabOf(value))}
      className="@container/project-panel h-full min-h-0 min-w-0 gap-0"
    >
      {/* As tall as the conversation's header beside it, so that their borders line up. */}
      <header data-panel-toolbar className="flex min-h-13 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <TabsList variant="line" className="min-w-max flex-1">
          <TabsTrigger value="files" aria-label="Files">
            <FilesIcon className="hidden @max-[400px]/project-panel:block" />
            <span className="@max-[400px]/project-panel:sr-only">Files</span>
          </TabsTrigger>
          <TabsTrigger value="changes" aria-label="Changes">
            <GitCompareIcon className="hidden @max-[400px]/project-panel:block" />
            <span className="@max-[400px]/project-panel:sr-only">Changes</span>
          </TabsTrigger>
          <TabsTrigger value="terminal" aria-label="Terminal">
            <SquareTerminalIcon className="hidden @max-[400px]/project-panel:block" />
            <span className="@max-[400px]/project-panel:sr-only">Terminal</span>
          </TabsTrigger>
          <TabsTrigger value="preview" aria-label="Preview">
            <GlobeIcon className="hidden @max-[400px]/project-panel:block" />
            <span className="@max-[400px]/project-panel:sr-only">Preview</span>
          </TabsTrigger>
        </TabsList>
        {/* A terminal draws itself as the shell writes: there is nothing to read again. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
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
                    disabled={refreshing || (panelTab === "changes" && changes === undefined)}
                    onClick={async () => {
                      if (refreshing) return;
                      setRefreshing(true);
                      try {
                        if (panelTab === "files") files.refresh();
                        else await changes?.refresh(BACKGROUND_CONTEXT);
                      } catch (error) {
                        toast.error("Could not refresh changes", {
                          description: error instanceof Error ? error.message : String(error),
                        });
                      } finally {
                        setRefreshing(false);
                      }
                    }}
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
      <TabsContent value="files" keepMounted className="flex min-h-0 flex-col">
        {visited.has("files") && (
          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
            <ResizablePanel id="tree" minSize={80} className="overflow-auto p-2">
              <FileTree files={files} showHidden={showHiddenFiles} />
            </ResizablePanel>
            {opened && (
              <>
                <ResizableHandle />
                <ResizablePanel id="file" defaultSize="60" minSize={120}>
                  <FileView files={files} comments={comments} active={active && panelTab === "files"} />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      </TabsContent>
      <TabsContent value="changes" keepMounted className="flex min-h-0 flex-col">
        {visited.has("changes") && (
          <ChangesView
            active={active && panelTab === "changes"}
            changes={changes}
            failure={changesFailure}
            comments={comments}
            reveal={changeTarget?.workspaceId === workspaceId ? changeTarget : undefined}
          />
        )}
      </TabsContent>
      {/* Kept mounted, so the terminals keep their screens and connections while another tab shows. */}
      <TabsContent value="terminal" keepMounted className="flex min-h-0 flex-col">
        {visited.has("terminal") && (
          <TerminalsView workspaceId={workspaceId} active={active && panelTab === "terminal"} />
        )}
      </TabsContent>
      {/* Kept mounted, so the preview iframe keeps its page state while another tab shows. */}
      <TabsContent value="preview" keepMounted className="flex min-h-0 flex-1 flex-col">
        {visited.has("preview") && <PreviewView active={active && panelTab === "preview"} />}
      </TabsContent>
    </Tabs>
  );
}
