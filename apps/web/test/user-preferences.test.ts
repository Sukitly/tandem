// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userPreferences } from "../src/app/user-preferences.ts";
import { panelTabOf } from "../src/app/workbench-store.ts";
import {
  choicePreference,
  flagPreference,
  readPreference,
  usePreference,
  writePreference,
} from "../src/lib/preferences.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("nothing chosen reads as each preference's default", () => {
  expect(readPreference(userPreferences.theme)).toBe("system");
  expect(readPreference(userPreferences.keyboardMode)).toBe("platform");
  expect(readPreference(userPreferences.sendMode)).toBe("steer");
  expect(readPreference(userPreferences.filesShown)).toBe(true);
  expect(readPreference(userPreferences.showHiddenFiles)).toBe(false);
  expect(readPreference(userPreferences.panelTab)).toBe("files");
  expect(readPreference(userPreferences.fileWrap)).toBe(false);
  expect(readPreference(userPreferences.diffStyle.inline)).toBe("unified");
  expect(readPreference(userPreferences.diffStyle.fullscreen)).toBe("split");
  expect(readPreference(userPreferences.diffStyle.narrow)).toBe("unified");
  expect(readPreference(userPreferences.diffWrap.inline)).toBe(false);
  expect(readPreference(userPreferences.diffWrap.fullscreen)).toBe(false);
});

test("each preference is kept under its own key, as the strings it takes", () => {
  const stored: [string, string, unknown, () => unknown][] = [
    ["tandem.theme", "dark", "dark", () => readPreference(userPreferences.theme)],
    ["tandem.keyboardMode", "emacs", "emacs", () => readPreference(userPreferences.keyboardMode)],
    ["tandem.sendMode", "followUp", "followUp", () => readPreference(userPreferences.sendMode)],
    ["tandem.filesShown", "false", false, () => readPreference(userPreferences.filesShown)],
    ["tandem.showHiddenFiles", "true", true, () => readPreference(userPreferences.showHiddenFiles)],
    ["tandem.panelTab", "terminal", "terminal", () => readPreference(userPreferences.panelTab)],
    ["tandem.fileWrap", "true", true, () => readPreference(userPreferences.fileWrap)],
    ["tandem.diffStyle", "split", "split", () => readPreference(userPreferences.diffStyle.inline)],
    ["tandem.diffStyle.zoomed", "unified", "unified", () => readPreference(userPreferences.diffStyle.fullscreen)],
    ["tandem.diffStyle.mobile", "split", "split", () => readPreference(userPreferences.diffStyle.narrow)],
    ["tandem.diffWrap", "true", true, () => readPreference(userPreferences.diffWrap.inline)],
    ["tandem.diffWrap.zoomed", "true", true, () => readPreference(userPreferences.diffWrap.fullscreen)],
  ];
  for (const [key, value, expected, read] of stored) {
    localStorage.setItem(key, value);
    expect(read(), key).toBe(expected);
    localStorage.removeItem(key);
  }
});

test("diff style and wrap are kept separately for the panel, full screen, and a narrow layout", () => {
  localStorage.setItem("tandem.diffStyle", "split");
  localStorage.setItem("tandem.diffStyle.zoomed", "unified");
  expect(readPreference(userPreferences.diffStyle.inline)).toBe("split");
  expect(readPreference(userPreferences.diffStyle.fullscreen)).toBe("unified");
  expect(readPreference(userPreferences.diffStyle.narrow)).toBe("unified");

  localStorage.setItem("tandem.diffWrap", "true");
  localStorage.setItem("tandem.diffWrap.zoomed", "false");
  expect(readPreference(userPreferences.diffWrap.inline)).toBe(true);
  expect(readPreference(userPreferences.diffWrap.fullscreen)).toBe(false);
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

test("a written value is stored as the string the preference formats it to", () => {
  writePreference(userPreferences.theme, "light");
  writePreference(userPreferences.filesShown, false);
  writePreference(userPreferences.diffStyle.fullscreen, "unified");
  expect(localStorage.getItem("tandem.theme")).toBe("light");
  expect(localStorage.getItem("tandem.filesShown")).toBe("false");
  expect(localStorage.getItem("tandem.diffStyle.zoomed")).toBe("unified");
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

test("a choice survives storage refusing it, for as long as the page lives", () => {
  const quota = flagPreference("test.quota", false);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  const view = renderHook(() => usePreference(quota));
  act(() => view.result.current[1](true));
  expect(view.result.current[0]).toBe(true);
});

test("a choice preference reads only its own values", () => {
  const color = choicePreference("test.color", ["red", "green"] as const, "green");
  expect(color.parse(null)).toBe("green");
  expect(color.parse("red")).toBe("red");
  expect(color.parse("blue")).toBe("green");
  expect(color.format("red")).toBe("red");
});
