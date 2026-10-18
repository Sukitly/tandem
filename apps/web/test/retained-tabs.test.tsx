// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test } from "vitest";
import { useVisitedTabs } from "../src/components/retained-tabs.tsx";

afterEach(cleanup);

test("hidden projects never acquire tabs visited in a different project", () => {
  const view = renderHook(({ tab, active }) => useVisitedTabs(tab, active), {
    initialProps: { tab: "files", active: true },
    wrapper: StrictMode,
  });
  view.rerender({ tab: "terminal", active: false });
  expect([...view.result.current]).toEqual(["files"]);
  view.rerender({ tab: "preview", active: false });
  expect([...view.result.current]).toEqual(["files"]);
  view.rerender({ tab: "terminal", active: true });
  expect([...view.result.current]).toEqual(["files", "terminal"]);
  view.rerender({ tab: "files", active: true });
  expect([...view.result.current]).toEqual(["files", "terminal"]);
});
