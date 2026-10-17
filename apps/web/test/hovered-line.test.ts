// @vitest-environment jsdom
import type { DiffLineEventBaseProps } from "@pierre/diffs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useHoveredLine } from "../src/changes/hovered-line.ts";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
function setup() {
  const container = document.createElement("div");
  const left = document.createElement("span");
  const right = document.createElement("span");
  const scroller = document.createElement("div");
  scroller.append(left, right);
  container.append(scroller);
  document.body.append(container);
  let rightEdge = 400;
  let height = 20;
  left.getBoundingClientRect = () => new DOMRect(0, 10, 40, 20);
  right.getBoundingClientRect = () => new DOMRect(rightEdge - 40, 10, 40, height);
  const hook = renderHook(() => useHoveredLine({ current: container }));
  const event = { pointerType: "mouse", clientX: 440, clientY: 15 } as PointerEvent;
  const line = (side: "additions" | "deletions"): DiffLineEventBaseProps & { event: PointerEvent } => ({
    type: "diff-line",
    lineNumber: 10,
    annotationSide: side,
    lineType: "context",
    lineElement: scroller,
    numberElement: side === "additions" ? right : left,
    numberColumn: false,
    event,
  });
  return {
    ...hook,
    line,
    scroller,
    container,
    resize: () => {
      rightEdge = 500;
      height = 40;
    },
  };
}
test("uses the supplied side and number element, even when both columns share a line number", () => {
  const { result, line } = setup();
  act(() => result.current.onLineEnter(line("additions")));
  expect(result.current.hovered).toMatchObject({ side: "additions", line: 10, right: 400 });
  act(() => result.current.onLineEnter(line("deletions")));
  expect(result.current.hovered).toMatchObject({ side: "deletions", line: 10, right: 40 });
});
test("remeasures width and height and hides on actual scroll and resize", () => {
  const { result, line, resize, container, scroller } = setup();
  act(() => result.current.onLineEnter(line("additions")));
  resize();
  act(() => container.dispatchEvent(new Event("pointermove")));
  expect(result.current.hovered).toMatchObject({ right: 500, height: 40 });
  act(() => scroller.dispatchEvent(new Event("scroll")));
  expect(result.current.hovered).toBeNull();
  act(() => container.dispatchEvent(new Event("pointermove")));
  expect(result.current.hovered).toMatchObject({ right: 500 });
  act(() => window.dispatchEvent(new Event("resize")));
  expect(result.current.hovered).toBeNull();
});
test("touch does not create hover UI", () => {
  const { result, line } = setup();
  const props = line("additions");
  act(() => result.current.onLineEnter({ ...props, event: { ...props.event, pointerType: "touch" } as PointerEvent }));
  expect(result.current.hovered).toBeNull();
});
