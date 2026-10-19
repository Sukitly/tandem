// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { nextMatch, useFileFinder } from "../src/files/file-finder.tsx";

const lines = ["alpha", "Beta", "gamma", "beta again", "delta"];

test("finds the next line holding the text, whatever its case, wrapping round the file", () => {
  expect(nextMatch(lines, "beta", null)).toBe(1);
  expect(nextMatch(lines, "beta", 1)).toBe(3);
  expect(nextMatch(lines, "beta", 3)).toBe(1);
  expect(nextMatch(lines, "alpha", 0)).toBe(0);
  expect(nextMatch(lines, "zeta", null)).toBeNull();
  expect(nextMatch([], "x", null)).toBeNull();
});

test("a line number goes to that line only when the file has it", () => {
  const goTo = vi.fn();
  const view = renderHook(() => useFileFinder(lines, goTo));
  expect(view.result.current.valid).toBe(true);
  act(() => view.result.current.setLine("4"));
  act(() => view.result.current.goToLine());
  expect(goTo).toHaveBeenLastCalledWith(4);

  for (const bad of ["0", "6", "-1", "1.5", ""]) {
    act(() => view.result.current.setLine(bad));
    expect(view.result.current.valid, bad).toBe(false);
    goTo.mockClear();
    act(() => view.result.current.goToLine());
    expect(goTo).not.toHaveBeenCalled();
  }
});

test("finding goes to each match in turn, says where it is, and shows the line in the line box", () => {
  const goTo = vi.fn();
  const view = renderHook(() => useFileFinder(lines, goTo));
  act(() => view.result.current.changeQuery("beta"));
  act(() => view.result.current.findNext());
  expect(goTo).toHaveBeenLastCalledWith(2);
  expect(view.result.current.status).toBe("Found on line 2");
  expect(view.result.current.line).toBe("2");
  act(() => view.result.current.findNext());
  expect(goTo).toHaveBeenLastCalledWith(4);
  act(() => view.result.current.findNext());
  expect(goTo).toHaveBeenLastCalledWith(2);
});

test("a text that is nowhere is said so, and changing the text starts the search over", () => {
  const goTo = vi.fn();
  const view = renderHook(() => useFileFinder(lines, goTo));
  act(() => view.result.current.changeQuery("zeta"));
  act(() => view.result.current.findNext());
  expect(view.result.current.status).toBe("No matching line");
  expect(goTo).not.toHaveBeenCalled();

  act(() => view.result.current.changeQuery("delta"));
  expect(view.result.current.status).toBeNull();
  act(() => view.result.current.findNext());
  expect(goTo).toHaveBeenLastCalledWith(5);
  act(() => view.result.current.changeQuery("a"));
  act(() => view.result.current.findNext());
  expect(goTo).toHaveBeenLastCalledWith(1);
});

test("an empty search does nothing", () => {
  const goTo = vi.fn();
  const view = renderHook(() => useFileFinder(lines, goTo));
  act(() => view.result.current.findNext());
  expect(goTo).not.toHaveBeenCalled();
  expect(view.result.current.status).toBeNull();
});
