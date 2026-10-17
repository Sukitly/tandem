import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useDefaultLayout, usePanelCallbackRef } from "react-resizable-panels";
import { useWorkbench } from "@/app/workbench.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { preferences } from "@/lib/preferences.ts";
import { PanelSurface } from "./panel-surface.tsx";
import { ProjectPanel } from "./project-panel.tsx";
import { retainedProjects } from "./retained-projects.ts";
import { usePanelFrame } from "./use-panel-frame.ts";

/** Stable conversation and panel trees; layout changes never move a preview document between DOM parents. */
export function WithFiles({
  workspaceId,
  availableWorkspaceIds,
  children,
}: {
  workspaceId: number | null;
  availableWorkspaceIds?: readonly number[];
  children?: ReactNode;
}) {
  const { filesShown, showFiles } = useWorkbench();
  const isMobile = useIsMobile();
  const root = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const frame = usePanelFrame(root, slot);
  // The sidebar can leave too little space for two columns even on a desktop-width viewport.
  const overlay = isMobile || (frame.visible && frame.width < 600);
  const shown =
    filesShown &&
    workspaceId !== null &&
    (availableWorkspaceIds === undefined || availableWorkspaceIds.includes(workspaceId));
  const visible = shown && frame.visible && (overlay || frame.panelWidth > 0);
  const retained = useRef<readonly number[]>([]);
  retained.current = retainedProjects(retained.current, workspaceId, visible, availableWorkspaceIds);
  const projects = retained.current;
  const layout = useDefaultLayout({
    id: "tandem.layout",
    panelIds: ["conversation", "files"],
    storage: preferences,
    onlySaveAfterUserInteractions: true,
  });
  const savedWidth = layout.defaultLayout?.files;
  const expandedWidth = useRef(
    savedWidth !== undefined && Number.isFinite(savedWidth) && savedWidth > 0 && savedWidth < 100 ? savedWidth : 35,
  );
  // Defaults initialize the group once; hiding it must not replace the user's expanded layout.
  const [initialLayout] = useState(() =>
    shown && !overlay
      ? { conversation: 100 - expandedWidth.current, files: expandedWidth.current }
      : { conversation: 100, files: 0 },
  );
  const [panel, panelRef] = usePanelCallbackRef();
  useLayoutEffect(() => {
    if (panel === null) return;
    if (shown && !overlay) panel.resize(`${expandedWidth.current}%`);
    else panel.collapse();
  }, [shown, overlay, panel]);

  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={initialLayout}
        onLayoutChanged={(next, meta) => {
          const width = meta.requestedLayout?.files ?? next.files;
          if (
            !overlay &&
            shown &&
            meta.isUserInteraction &&
            width !== undefined &&
            Number.isFinite(width) &&
            width > 0 &&
            width < 100
          ) {
            expandedWidth.current = width;
            layout.onLayoutChanged(next, meta);
          }
        }}
      >
        <ResizablePanel id="conversation" minSize={overlay ? 0 : 360} className="flex min-w-0 flex-col">
          {children}
        </ResizablePanel>
        <ResizableHandle hidden={!shown || overlay} disabled={!shown || overlay} />
        <ResizablePanel
          id="files"
          panelRef={panelRef}
          defaultSize="35%"
          minSize={240}
          collapsible
          collapsedSize={0}
          disabled={!shown || overlay}
          onResize={(size, _id, previous) => {
            if (!overlay && shown && previous !== undefined && previous.asPercentage > 0 && size.asPercentage === 0)
              showFiles(false);
          }}
        >
          <div ref={slot} className="h-full min-h-0" aria-hidden="true" />
        </ResizablePanel>
      </ResizablePanelGroup>
      <PanelSurface visible={visible} overlay={overlay} frame={frame} onClose={() => showFiles(false)}>
        <div className="min-h-0 flex-1">
          {projects.map((id) => (
            <div key={id} data-workspace-panel={id} hidden={id !== workspaceId} className="h-full min-h-0">
              <ProjectPanel
                workspaceId={id}
                active={visible && id === workspaceId}
                onClose={overlay ? () => showFiles(false) : undefined}
              />
            </div>
          ))}
        </div>
      </PanelSurface>
    </div>
  );
}
