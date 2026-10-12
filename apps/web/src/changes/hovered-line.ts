import { type RefObject, useEffect, useRef, useState } from "react";

type Side = "additions" | "deletions";

/** The line of a diff the pointer is on, and where its number sits, so that a control can be shown beside it. */
export interface HoveredLine {
  side: Side;
  line: number;
  /** In the container's coordinates. */
  top: number;
  height: number;
  /** Where the line's number cell ends, in the container's coordinates. */
  right: number;
}

/** Where the control for the hovered line is, in the page's coordinates, so that the pointer on it is not a new line. */
interface Control {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** How wide the control is, and how far it reaches past the number cell it is beside. */
const CONTROL_WIDTH = 20;
const CONTROL_OVERHANG = 6;

/**
 * Follow the pointer over a diff, as a code host does for the button that writes a comment on a line.
 *
 * The line comes from the diff's own numbering: the number cell under the pointer names it, and which side of the patch
 * it belongs to is decided as the library decides it for comments—a removed line is the old file's, a context line is
 * the new file's unless it is in the left column of a two-column diff.
 */
export function useHoveredLine(container: RefObject<HTMLElement | null>): HoveredLine | null {
  const [hovered, setHovered] = useState<HoveredLine | null>(null);
  // What is shown, and where its control is: the pointer leaving the diff for that control is not a new line.
  const showing = useRef<{ hovered: HoveredLine; control: Control } | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const hide = (): void => {
      showing.current = null;
      setHovered(null);
    };
    const onMove = (event: PointerEvent): void => {
      // A finger does not hover.
      if (event.pointerType !== "mouse") return;
      const cell = lineCellAt(element, event);
      if (cell === null) {
        if (showing.current !== null && onControl(showing.current.control, event)) return;
        hide();
        return;
      }
      const line = Number.parseInt(cell.getAttribute("data-column-number") ?? "", 10);
      if (!Number.isSafeInteger(line) || line <= 0) {
        hide();
        return;
      }
      const box = element.getBoundingClientRect();
      const rect = cell.getBoundingClientRect();
      const next: HoveredLine = {
        side: sideOf(cell),
        line,
        top: rect.top - box.top,
        height: rect.height,
        right: rect.right - box.left,
      };
      showing.current = {
        hovered: next,
        control: {
          left: rect.right - CONTROL_WIDTH + CONTROL_OVERHANG,
          right: rect.right + CONTROL_OVERHANG,
          top: rect.top,
          bottom: rect.bottom,
        },
      };
      // Only a move onto another line, or to where that line now is, is a change worth a render.
      setHovered((previous) =>
        previous !== null && previous.line === next.line && previous.side === next.side && previous.top === next.top
          ? previous
          : next,
      );
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", hide);
    // Scrolling moves the lines under a pointer that does not move; the next move puts the control right again.
    element.addEventListener("wheel", hide, { passive: true });
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", hide);
      element.removeEventListener("wheel", hide);
    };
  }, [container]);

  return hovered;
}

function onControl(control: Control, event: PointerEvent): boolean {
  return (
    event.clientX >= control.left - 4 &&
    event.clientX <= control.right + 4 &&
    event.clientY >= control.top - 4 &&
    event.clientY <= control.bottom + 4
  );
}

/**
 * The number cell of the line the pointer is on, which is what names the line and says where its number sits. The whole
 * row is the line, not only its number: the pointer may be on the code, and the row then leads to the number cell of
 * the same line.
 *
 * The diff renders inside a shadow root, so the point is asked of that root rather than of the page, which would answer
 * with the diff as a whole; the event's own path is a fallback for a diff whose root is not where it is expected.
 */
function lineCellAt(container: HTMLElement, event: PointerEvent): HTMLElement | null {
  const point = pointElement(container, event);
  if (point === null) return null;
  const cell = point.closest("[data-column-number]");
  if (cell instanceof HTMLElement) return cell;
  const row = point.closest("[data-line]");
  if (!(row instanceof HTMLElement)) return null;
  const line = row.getAttribute("data-line");
  const index = row.getAttribute("data-line-index");
  if (line === null || index === null) return null;
  const root = row.getRootNode();
  if (!(root instanceof ShadowRoot) && !(root instanceof Document)) return null;
  const named = root.querySelector(`[data-column-number="${line}"][data-line-index="${index}"]`);
  return named instanceof HTMLElement ? named : null;
}

/** The innermost element of a diff under the pointer. */
function pointElement(container: HTMLElement, event: PointerEvent): HTMLElement | null {
  for (const host of container.querySelectorAll("diffs-container")) {
    const found = host.shadowRoot?.elementFromPoint(event.clientX, event.clientY);
    if (found instanceof HTMLElement) return found;
  }
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement) return target;
  }
  return null;
}

function sideOf(cell: HTMLElement): Side {
  const lineType = cell.getAttribute("data-line-type");
  if (lineType === "change-deletion") return "deletions";
  if (lineType === "change-addition") return "additions";
  return cell.closest("[data-deletions]") === null ? "additions" : "deletions";
}
