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
      const available =
        viewElement.getBoundingClientRect().right - boxElement.getBoundingClientRect().left - RIGHT_MARGIN;
      setWidth(Math.max(MINIMUM_WIDTH, Math.floor(available)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewElement);
    return () => observer.disconnect();
  }, [box, view]);

  return width;
}
