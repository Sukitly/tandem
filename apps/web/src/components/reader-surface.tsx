import { WrapTextIcon } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { IconAction } from "@/components/icon-action.tsx";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function ReaderWrapButton({ wrap, onToggle }: { wrap: boolean; onToggle(): void }) {
  const label = wrap ? "Do not wrap lines" : "Wrap lines";
  return (
    <IconAction
      variant={wrap ? "secondary" : "ghost"}
      size="icon-xs"
      label={label}
      aria-pressed={wrap}
      onClick={onToggle}
    >
      <WrapTextIcon />
    </IconAction>
  );
}

function moveReader(host: HTMLElement, target: HTMLElement): void {
  const positions = [host, ...host.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
    .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  target.appendChild(host);
  for (const { element, top, left } of positions) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
}

/** One reader subtree, moved into a modal portal without remounting its editor, renderer, or scroll position. */
export function ReaderSurface({
  label,
  toggleRef,
  expanded,
  onExpandedChange,
  children,
}: {
  label: string;
  /** The caller owns the toggle; its accessible name is not part of the focus contract. */
  toggleRef: RefObject<HTMLButtonElement | null>;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  children: ReactNode;
}) {
  const [host] = useState(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "flex h-full min-h-0 min-w-0 flex-col bg-background";
    return element;
  });
  const mountInline = useCallback(
    (element: HTMLDivElement | null) => {
      if (element !== null && host !== null && !expanded) moveReader(host, element);
    },
    [host, expanded],
  );
  const mountFullscreen = useCallback(
    (element: HTMLDivElement | null) => {
      if (element !== null && host !== null && expanded) moveReader(host, element);
    },
    [host, expanded],
  );
  const toggle = () => toggleRef.current ?? false;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={label}>
      <Dialog open={expanded} onOpenChange={onExpandedChange}>
        <div ref={mountInline} className="h-full min-h-0" />
        <DialogContent
          showCloseButton={false}
          initialFocus={toggle}
          finalFocus={toggle}
          className="top-0 left-0 flex h-dvh w-dvw max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none data-open:animate-none data-closed:animate-none"
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <div ref={mountFullscreen} className="min-h-0 flex-1" />
        </DialogContent>
        {host === null ? children : createPortal(children, host)}
      </Dialog>
    </section>
  );
}
