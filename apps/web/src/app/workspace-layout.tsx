import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useDefaultLayout, usePanelCallbackRef } from "react-resizable-panels";
import { useWorkbench } from "@/app/workbench.tsx";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { preferences } from "@/lib/preferences.ts";
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
  const popup = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(false);
  const frame = usePanelFrame(root, slot);
  // The sidebar can leave too little space for two columns even on a desktop-width viewport.
  const overlay = isMobile || (frame.visible && frame.width < 600);
  const shown =
    filesShown &&
    workspaceId !== null &&
    (availableWorkspaceIds === undefined || availableWorkspaceIds.includes(workspaceId));
  const visible = shown && frame.visible && (overlay || frame.panelWidth > 0);
  useLayoutEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (opening) returnFocus.current = null;
    if (!overlay || !visible || popup.current === null) return;
    const focused = document.activeElement;
    // Becoming modal while already open does not run Base UI's opening autofocus again.
    if (focused instanceof HTMLElement && popup.current.contains(focused) && focused.getClientRects().length > 0)
      return;
    if (!opening && focused instanceof HTMLElement && focused !== document.body) returnFocus.current = focused;
    popup.current.focus({ preventScroll: true });
  }, [overlay, visible]);
  const [retained, setRetained] = useState<readonly number[]>([]);
  const projects = retainedProjects(retained, workspaceId, visible, availableWorkspaceIds);
  if (projects !== retained) setRetained(projects);
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
      <Drawer
        open={visible}
        modal={overlay}
        disablePointerDismissal={!overlay}
        onOpenChange={(open, details) => {
          if (!overlay && details.reason === "swipe") return;
          showFiles(open);
        }}
        showSwipeHandle={overlay}
      >
        <DrawerContent
          ref={popup}
          keepMounted
          initialFocus={overlay ? undefined : false}
          finalFocus={overlay ? () => (returnFocus.current?.isConnected ? returnFocus.current : true) : false}
          data-base-ui-swipe-ignore={overlay ? undefined : ""}
          className={overlay ? "h-[85dvh] max-h-[85dvh] p-0 pb-[env(safe-area-inset-bottom,0px)]" : "p-0"}
          style={
            overlay
              ? undefined
              : {
                  left: frame.left,
                  top: frame.top,
                  right: "auto",
                  bottom: "auto",
                  width: frame.panelWidth,
                  height: frame.height,
                  maxHeight: "none",
                  margin: 0,
                  transform: "none",
                  borderRadius: 0,
                  border: 0,
                  transition: "none",
                  display: visible && frame.panelWidth > 0 ? "flex" : "none",
                }
          }
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>Project panel</DrawerTitle>
            <DrawerDescription>Project files, changes, terminals, and preview</DrawerDescription>
          </DrawerHeader>
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
        </DrawerContent>
      </Drawer>
    </div>
  );
}
