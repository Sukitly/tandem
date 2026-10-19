import { type ReactNode, useLayoutEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { PANEL_LAYOUT_KEY } from "@/app/user-preferences.ts";
import { useWorkbench } from "@/app/workbench.tsx";
import { AdaptivePanel, type PanelVisibility } from "@/components/adaptive-panel.tsx";
import { ProjectPanel } from "./project-panel.tsx";
import { retainedProjects } from "./retained-projects.ts";

export function WithFiles({
  workspaceId,
  availableWorkspaceIds,
  children,
}: {
  workspaceId: number | null;
  availableWorkspaceIds?: readonly number[];
  children?: ReactNode;
}) {
  const { filesShown, showFiles } = useWorkbench((state) => ({
    filesShown: state.filesShown,
    showFiles: state.showFiles,
  }));
  const shown =
    filesShown &&
    workspaceId !== null &&
    (availableWorkspaceIds === undefined || availableWorkspaceIds.includes(workspaceId));
  return (
    <AdaptivePanel
      label="Project panel"
      description="Project files, changes, terminals, and preview"
      layoutKey={PANEL_LAYOUT_KEY}
      shown={shown}
      onShownChange={showFiles}
      renderPanel={(visibility) => (
        <ProjectPanels
          workspaceId={workspaceId}
          available={availableWorkspaceIds}
          visibility={visibility}
          onClose={() => showFiles(false)}
        />
      )}
    >
      {children}
    </AdaptivePanel>
  );
}

/** Project retention is domain state, not a side effect of resizing or rendering a drawer. */
function ProjectPanels({
  workspaceId,
  available,
  visibility,
  onClose,
}: {
  workspaceId: number | null;
  available: readonly number[] | undefined;
  visibility: PanelVisibility;
  onClose(): void;
}) {
  const [store] = useState(() => createStore<readonly number[]>(() => []));
  const previous = useStore(store);
  const projects = retainedProjects(previous, workspaceId, visibility.visible, available);
  // Publish committed visits only. An abandoned concurrent render must not acquire hidden resources.
  useLayoutEffect(() => {
    if (projects !== store.getState()) store.setState(projects, true);
  }, [projects, store]);
  return (
    <div className="min-h-0 flex-1">
      {projects.map((id) => (
        <div key={id} data-workspace-panel={id} hidden={id !== workspaceId} className="h-full min-h-0">
          <ProjectPanel
            workspaceId={id}
            active={visibility.visible && id === workspaceId}
            onClose={visibility.overlay ? onClose : undefined}
          />
        </div>
      ))}
    </div>
  );
}
