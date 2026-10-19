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
import { useState } from "react";
import { toast } from "sonner";
import { panelTabOf, useProjectResources, useWorkbench } from "@/app/workbench.tsx";
import { ChangesView } from "@/changes/changes-view.tsx";
import { IconAction } from "@/components/icon-action.tsx";
import { RetainedTab, useVisitedTabs } from "@/components/retained-tabs.tsx";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilesPanel } from "@/files/files-panel.tsx";
import { PreviewView } from "@/preview/preview-view.tsx";
import { useProjectChanges, useProjectChangesFailure } from "@/rpc/use-project-changes.ts";
import { TerminalsView } from "@/terminals/terminals-view.tsx";

const PANEL_TABS = [
  { value: "files", label: "Files", icon: FilesIcon },
  { value: "changes", label: "Changes", icon: GitCompareIcon },
  { value: "terminal", label: "Terminal", icon: SquareTerminalIcon },
  { value: "preview", label: "Preview", icon: GlobeIcon },
] as const;

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
  const workbench = useWorkbench((state) => ({
    panelTab: state.panelTab,
    showTab: state.showTab,
    changeTarget: state.changeTarget,
    showHiddenFiles: state.showHiddenFiles,
    setShowHiddenFiles: state.setShowHiddenFiles,
  }));
  const resources = useProjectResources();
  const [refreshing, setRefreshing] = useState(false);
  const { panelTab, showTab, changeTarget, showHiddenFiles = false, setShowHiddenFiles } = workbench;
  const files = resources.files(workspaceId);
  const comments = resources.comments(workspaceId);
  // Retained projects create expensive tabs only after the user visits them.
  const visited = useVisitedTabs(panelTab, active);
  const changes = useProjectChanges(workspaceId, active && visited.has("changes"));
  const changesFailure = useProjectChangesFailure(workspaceId);
  return (
    <Tabs
      value={panelTab}
      onValueChange={(value) => showTab(panelTabOf(value))}
      className="@container/project-panel h-full min-h-0 min-w-0 gap-0"
    >
      {/* As tall as the conversation's header beside it, so that their borders line up. */}
      <header data-panel-toolbar className="flex min-h-13 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        <TabsList variant="line" className="min-w-max flex-1">
          {PANEL_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} aria-label={label}>
              <Icon className="hidden @max-[400px]/project-panel:block" />
              <span className="@max-[400px]/project-panel:sr-only">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* A terminal draws itself as the shell writes: there is nothing to read again. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {panelTab === "files" && (
            <IconAction
              variant="ghost"
              size="icon-xs"
              label={showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
              aria-pressed={showHiddenFiles}
              className={showHiddenFiles ? "text-foreground" : undefined}
              onClick={() => setShowHiddenFiles?.(!showHiddenFiles)}
            >
              {showHiddenFiles ? <EyeIcon /> : <EyeOffIcon />}
            </IconAction>
          )}
          {panelTab !== "terminal" && panelTab !== "preview" && (
            <IconAction
              variant="ghost"
              size="icon-xs"
              label="Refresh"
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
            >
              <RotateCwIcon />
            </IconAction>
          )}
          {onClose && (
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          )}
        </div>
      </header>
      <RetainedTab value="files" label="Files" visited={visited}>
        <FilesPanel
          files={files}
          comments={comments}
          showHidden={showHiddenFiles}
          active={active && panelTab === "files"}
        />
      </RetainedTab>
      <RetainedTab value="changes" label="Changes" visited={visited}>
        <ChangesView
          active={active && panelTab === "changes"}
          changes={changes}
          failure={changesFailure}
          comments={comments}
          reveal={changeTarget?.workspaceId === workspaceId ? changeTarget : undefined}
        />
      </RetainedTab>
      {/* Kept mounted, so the terminals keep their screens and connections while another tab shows. */}
      <RetainedTab value="terminal" label="Terminal" visited={visited}>
        <TerminalsView workspaceId={workspaceId} active={active && panelTab === "terminal"} />
      </RetainedTab>
      {/* Kept mounted, so the preview iframe keeps its page state while another tab shows. */}
      <RetainedTab value="preview" label="Preview" visited={visited}>
        <PreviewView active={active && panelTab === "preview"} />
      </RetainedTab>
    </Tabs>
  );
}
