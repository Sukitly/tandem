// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userPreferences } from "../src/app/user-preferences.ts";
import { panelTabOf } from "../src/app/workbench-store.ts";
import { readPreference, usePreference } from "../src/lib/preferences.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a stored value the preference does not take reads as its default", () => {
  localStorage.setItem("tandem.theme", "blue");
  localStorage.setItem("tandem.filesShown", "maybe");
  localStorage.setItem("tandem.showHiddenFiles", "maybe");
  localStorage.setItem("tandem.panelTab", "nowhere");
  expect(readPreference(userPreferences.theme)).toBe("system");
  expect(readPreference(userPreferences.filesShown)).toBe(true);
  expect(readPreference(userPreferences.showHiddenFiles)).toBe(false);
  expect(readPreference(userPreferences.panelTab)).toBe("files");
  expect(panelTabOf("nowhere")).toBe("files");
  expect(panelTabOf(42)).toBe("files");
  expect(panelTabOf("preview")).toBe("preview");
});

test("components showing a preference change together when one of them changes it", () => {
  const first = renderHook(() => usePreference(userPreferences.fileWrap));
  const second = renderHook(() => usePreference(userPreferences.fileWrap));
  const other = renderHook(() => usePreference(userPreferences.diffWrap.inline));
  expect(first.result.current[0]).toBe(false);

  act(() => first.result.current[1](true));
  expect(first.result.current[0]).toBe(true);
  expect(second.result.current[0]).toBe(true);
  expect(other.result.current[0]).toBe(false);
  expect(localStorage.getItem("tandem.fileWrap")).toBe("true");

  // A component that appears later starts from what was chosen.
  const later = renderHook(() => usePreference(userPreferences.fileWrap));
  expect(later.result.current[0]).toBe(true);
});

test("the setter keeps its identity, so effects and memoized children are not disturbed", () => {
  const view = renderHook(() => usePreference(userPreferences.theme));
  const set = view.result.current[1];
  act(() => set("dark"));
  view.rerender();
  expect(view.result.current[1]).toBe(set);
  expect(view.result.current[0]).toBe("dark");
});
