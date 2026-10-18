// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePanelFrame } from "../src/hooks/use-panel-frame.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("frame measurements coalesce outside resize delivery and clean up pending work", () => {
  const root = document.createElement("div");
  const slot = document.createElement("div");
  let width = 1000;
  vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => ({ width, height: 800 }) as DOMRect);
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({ left: 650, top: 30, width: 350, height: 800 } as DOMRect);
  let notify = () => {};
  let animation: FrameRequestCallback = () => {};
  const disconnect = vi.fn();
  const request = vi.fn((callback: FrameRequestCallback) => {
    animation = callback;
    return 37;
  });
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const rootRef = { current: root };
  const slotRef = { current: slot };
  const hook = renderHook(() => usePanelFrame(rootRef, slotRef));
  expect(hook.result.current).toMatchObject({ width: 1000, visible: true, left: 650, top: 30 });
  width = 0;
  act(() => {
    notify();
    notify();
    window.dispatchEvent(new Event("resize"));
  });
  expect(request).toHaveBeenCalledOnce();
  expect(hook.result.current.visible).toBe(true);
  act(() => animation(0));
  expect(hook.result.current.visible).toBe(false);
  act(() => notify());
  hook.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledWith(37);
  window.dispatchEvent(new Event("resize"));
  expect(request).toHaveBeenCalledTimes(2);
});
