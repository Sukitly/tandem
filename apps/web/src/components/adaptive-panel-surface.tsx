import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerSwipeHandle,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { usePanelFrame } from "@/hooks/use-panel-frame.ts";

/**
 * One persistent portal host. The Drawer is active only as an overlay; its kept-mounted
 * element becomes an ordinary desktop region without moving its iframe or terminal children.
 */
export function PanelSurface({
  visible,
  overlay,
  frame,
  onClose,
  label,
  description,
  children,
}: {
  visible: boolean;
  overlay: boolean;
  frame: ReturnType<typeof usePanelFrame>;
  onClose(): void;
  label: string;
  description: string;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(false);
  useLayoutEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (opening) returnFocus.current = null;
    if (!overlay || !visible || popup.current === null) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && popup.current.contains(focused) && focused.getClientRects().length > 0)
      return;
    if (!opening && focused instanceof HTMLElement && focused !== document.body) returnFocus.current = focused;
    popup.current.focus({ preventScroll: true });
  }, [overlay, visible]);

  return (
    <Drawer
      open={visible}
      modal={overlay}
      disablePointerDismissal={!overlay}
      onOpenChange={(open, details) => {
        if (
          !overlay &&
          (details.reason === "swipe" || details.reason === "escape-key" || details.reason === "outside-press")
        )
          return;
        if (!open) onClose();
      }}
      showSwipeHandle={overlay}
    >
      <DrawerPortal keepMounted>
        {overlay && <DrawerOverlay />}
        <DrawerPrimitive.Viewport
          hidden={!visible}
          data-slot="drawer-viewport"
          data-modal={overlay}
          className={overlay ? "pointer-events-none fixed inset-0 z-50" : undefined}
        >
          <DrawerPrimitive.Popup
            ref={popup}
            data-slot="drawer-popup"
            data-swipe-axis="y"
            initialFocus={
              overlay
                ? () => {
                    const focused = document.activeElement;
                    return focused instanceof HTMLElement && popup.current?.contains(focused) ? false : popup.current;
                  }
                : false
            }
            finalFocus={overlay ? () => (returnFocus.current?.isConnected ? returnFocus.current : true) : false}
            data-base-ui-swipe-ignore={overlay ? undefined : ""}
            render={(props) => {
              if (overlay) return <div {...props} role="dialog" aria-modal="true" />;
              const regionProps = { ...props, onKeyDown: undefined, "aria-modal": undefined };
              // biome-ignore lint/a11y/useSemanticElements: Changing this element's tag would reload retained iframe documents.
              return <div {...regionProps} role="region" hidden={!visible} />;
            }}
            className={`group/drawer-popup pointer-events-auto fixed z-50 flex min-h-0 flex-col bg-popover text-sm text-popover-foreground outline-none ${overlay ? "inset-x-0 bottom-0 h-[85dvh] max-h-[85dvh] rounded-t-xl border-t pb-[env(safe-area-inset-bottom,0px)]" : ""}`}
            style={
              overlay
                ? { transform: "translateY(var(--drawer-swipe-movement-y, 0px))" }
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
            {overlay && <DrawerSwipeHandle />}
            <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DrawerHeader className="sr-only">
                <DrawerTitle>{label}</DrawerTitle>
                <DrawerDescription>{description}</DrawerDescription>
              </DrawerHeader>
              {children}
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPortal>
    </Drawer>
  );
}
