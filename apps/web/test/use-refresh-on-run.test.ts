// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRefreshOnRun } from "../src/hooks/use-refresh-on-run.ts";

afterEach(cleanup);

test("reads when a key is first shown, and again when it changes, but not on every render", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook((props: { key: number }) => useRefreshOnRun(props.key, false, refresh), {
    initialProps: { key: 1 },
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenLastCalledWith(1, "shown");
  view.rerender({ key: 1 });
  expect(refresh).toHaveBeenCalledTimes(1);
  view.rerender({ key: 2 });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenLastCalledWith(2, "shown");
});

test("reads once more when a run ends, not when it starts", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook((props: { active: boolean }) => useRefreshOnRun(1, props.active, refresh), {
    initialProps: { active: false },
  });
  refresh.mockClear();
  view.rerender({ active: true });
  expect(refresh).not.toHaveBeenCalled();
  view.rerender({ active: false });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenLastCalledWith(1, "ended");
});

test("a run already going when the key is first shown still ends with a read", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook((props: { active: boolean }) => useRefreshOnRun(1, props.active, refresh), {
    initialProps: { active: true },
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  view.rerender({ active: false });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenLastCalledWith(1, "ended");
});

test("reads nothing without a key", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook((props: { active: boolean }) => useRefreshOnRun(undefined, props.active, refresh), {
    initialProps: { active: true },
  });
  view.rerender({ active: false });
  expect(refresh).not.toHaveBeenCalled();
});

test("a refresh that fails is left for the next one", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  const refresh = vi.fn().mockRejectedValue(new Error("offline"));
  const view = renderHook((props: { active: boolean }) => useRefreshOnRun(1, props.active, refresh), {
    initialProps: { active: true },
  });
  view.rerender({ active: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", unhandled);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(unhandled).not.toHaveBeenCalled();
});
