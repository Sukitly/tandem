import { type RefObject, useLayoutEffect, useState } from "react";

type Frame = { visible: boolean; width: number; left: number; top: number; panelWidth: number; height: number };
const EMPTY: Frame = { visible: false, width: 0, left: 0, top: 0, panelWidth: 0, height: 0 };

/** A fixed portal follows the desktop slot without ever reparenting its iframe or terminal DOM. */
export function usePanelFrame(root: RefObject<HTMLDivElement | null>, slot: RefObject<HTMLDivElement | null>): Frame {
  const [frame, setFrame] = useState(EMPTY);
  useLayoutEffect(() => {
    const element = root.current;
    const anchor = slot.current;
    if (element === null || anchor === null) return;
    const update = (): void => {
      const outer = element.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      const next: Frame = {
        visible: outer.width > 0 && outer.height > 0,
        width: outer.width,
        left: rect.left,
        top: rect.top,
        panelWidth: rect.width,
        height: rect.height,
      };
      setFrame((previous) =>
        Object.keys(next).every((key) => previous[key as keyof Frame] === next[key as keyof Frame]) ? previous : next,
      );
    };
    update();
    // Resize delivery must not synchronously change the observed panel's layout (collapse/expand).
    let pending: number | undefined;
    const schedule = (): void => {
      if (pending !== undefined) return;
      pending = requestAnimationFrame(() => {
        pending = undefined;
        update();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    observer.observe(anchor);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      if (pending !== undefined) cancelAnimationFrame(pending);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [root, slot]);
  return frame;
}
