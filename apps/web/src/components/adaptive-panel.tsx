import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useDefaultLayout, usePanelCallbackRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { usePanelFrame } from "@/hooks/use-panel-frame.ts";
import { preferences } from "@/lib/preferences.ts";
import { PanelSurface } from "./adaptive-panel-surface.tsx";

export interface PanelVisibility {
  visible: boolean;
  overlay: boolean;
}

/** Layout only. The caller composes the main content and owns the resources rendered in the retained panel. */
export function AdaptivePanel({
  shown,
  onShownChange,
  children,
  renderPanel,
  label,
  description,
  layoutKey,
}: {
  shown: boolean;
  label: string;
  description: string;
  layoutKey: string;
  onShownChange(shown: boolean): void;
  children?: ReactNode;
  renderPanel(visibility: PanelVisibility): ReactNode;
}) {
  const isMobile = useIsMobile();
  const root = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const frame = usePanelFrame(root, slot);
  // The sidebar can leave too little space for two columns even on a desktop-width viewport.
  const overlay = isMobile || (frame.visible && frame.width < 600);
  const visible = shown && frame.visible && (overlay || frame.panelWidth > 0);
  const layout = useDefaultLayout({
    id: layoutKey,
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
              onShownChange(false);
          }}
        >
          <div ref={slot} className="h-full min-h-0" aria-hidden="true" />
        </ResizablePanel>
      </ResizablePanelGroup>
      <PanelSurface
        label={label}
        description={description}
        visible={visible}
        overlay={overlay}
        frame={frame}
        onClose={() => onShownChange(false)}
      >
        {renderPanel({ visible, overlay })}
      </PanelSurface>
    </div>
  );
}
