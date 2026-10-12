import { type RefObject, useEffect, useState } from "react";

/** What a comment box leaves to its right margin. */
const RIGHT_MARGIN = 8;

/** The narrowest a comment box may become, so that it stays usable in a panel dragged narrow. */
const MINIMUM_WIDTH = 160;

/**
 * How wide a comment box may be: from where it begins to the right edge of the view it is in.
 *
 * A diff and an opened file are as wide as their longest line, so a box that took its width from its surroundings would
 * run past the panel and be cut off. Where the box begins is set by the layout around it—the line numbers beside it,
 * say—and does not change with its own width, so measuring that while the width is not set yet is right. The width is
 * taken when the box appears and whenever the view changes size.
 */
export function useCommentWidth(
  box: RefObject<HTMLDivElement | null>,
  view: RefObject<HTMLDivElement | null> | undefined,
): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const boxElement = box.current;
    const viewElement = view?.current;
    if (viewElement === null || viewElement === undefined || boxElement === null) return;
    const measure = (): void => {
      const boxBox = boxElement.getBoundingClientRect();
      const viewBox = viewElement.getBoundingClientRect();
      // A box that is not on screen—its tab is not shown—has no place to measure from. It is measured when it is, since
      // the observer then reports the box and the view gaining a size.
      if (boxBox.width === 0 || viewBox.width === 0) return;
      setWidth(Math.max(MINIMUM_WIDTH, Math.floor(viewBox.right - boxBox.left - RIGHT_MARGIN)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewElement);
    // The box too: where it begins moves when the layout around it changes, as a wider line number column does.
    observer.observe(boxElement);
    return () => observer.disconnect();
  }, [box, view]);

  return width;
}
