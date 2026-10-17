import type { DiffLineEventBaseProps, LineEventBaseProps } from "@pierre/diffs";
import { type CSSProperties, type RefObject, useCallback, useEffect, useRef, useState } from "react";

export interface HoveredLine {
  side: "additions" | "deletions";
  line: number;
  top: number;
  height: number;
  right: number;
}

const CONTROL_WIDTH = 24;
const CONTROL_OVERHANG = 6;

export function controlPlacement(hovered: HoveredLine): CSSProperties {
  return { top: hovered.top, left: hovered.right - CONTROL_WIDTH + CONTROL_OVERHANG, height: hovered.height };
}

type LineEvent = (DiffLineEventBaseProps | LineEventBaseProps) & { event: PointerEvent };

/** Use the renderer's public line events, including its side and number element, never Shadow DOM hit testing. */
export function useHoveredLine(container: RefObject<HTMLElement | null>) {
  const [hovered, setHovered] = useState<HoveredLine | null>(null);
  const current = useRef<DiffLineEventBaseProps | null>(null);
  const hide = useCallback(() => {
    current.current = null;
    setHovered(null);
  }, []);
  const measure = useCallback(() => {
    const line = current.current;
    const element = container.current;
    if (line === null || element === null || !line.numberElement.isConnected) {
      hide();
      return;
    }
    const box = element.getBoundingClientRect();
    const rect = line.numberElement.getBoundingClientRect();
    const next: HoveredLine = {
      line: line.lineNumber,
      side: line.annotationSide,
      top: rect.top - box.top,
      height: rect.height,
      right: rect.right - box.left,
    };
    setHovered((previous) =>
      previous !== null &&
      previous.line === next.line &&
      previous.side === next.side &&
      previous.top === next.top &&
      previous.right === next.right &&
      previous.height === next.height
        ? previous
        : next,
    );
  }, [container, hide]);

  const onLineEnter = useCallback(
    (line: LineEvent) => {
      if (line.type !== "diff-line" || line.event.pointerType !== "mouse") return;
      current.current = line;
      measure();
    },
    [measure],
  );
  const onLineLeave = useCallback(
    ({ event }: LineEvent) => {
      const rect = current.current?.numberElement.getBoundingClientRect();
      // The overlay is outside the renderer. Moving onto it must not remove the button before it can be clicked.
      if (
        rect &&
        event.clientX >= rect.right - CONTROL_WIDTH + CONTROL_OVERHANG - 4 &&
        event.clientX <= rect.right + CONTROL_OVERHANG + 4 &&
        event.clientY >= rect.top - 4 &&
        event.clientY <= rect.bottom + 4
      )
        return;
      hide();
    },
    [hide],
  );

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const invalidate = (): void => setHovered(null);
    // Capture scroll: scrollbar dragging, touch, keyboard and programmatic scrolling do not necessarily emit wheel.
    element.addEventListener("scroll", invalidate, true);
    element.addEventListener("pointerleave", hide);
    element.addEventListener("pointermove", measure);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(invalidate);
    observer?.observe(element);
    window.addEventListener("resize", invalidate);
    return () => {
      element.removeEventListener("scroll", invalidate, true);
      element.removeEventListener("pointerleave", hide);
      element.removeEventListener("pointermove", measure);
      window.removeEventListener("resize", invalidate);
      observer?.disconnect();
    };
  }, [container, hide, measure]);

  return { hovered, onLineEnter, onLineLeave, hide };
}
