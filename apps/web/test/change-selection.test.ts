// @vitest-environment jsdom
import type { ChangedFile, ChangesState } from "@tandem/contracts";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";
import { selectionAfter, useChangeSelection } from "../src/changes/use-change-selection.ts";

const file = (path: string): ChangedFile => ({ path, status: "modified" });
const ready = (...paths: string[]): ChangesState => ({ workspaceId: 1, status: "ready", files: paths.map(file) });

test("the first file of the list is chosen once, and kept while the list holds it", () => {
  const files = [file("a.ts"), file("b.ts")];
  expect(selectionAfter(files, null, false)).toEqual({ selected: "a.ts", initialized: true });
  expect(selectionAfter(files, "b.ts", true)).toEqual({ selected: "b.ts", initialized: true });
  expect(selectionAfter([file("a.ts")], "b.ts", true)).toEqual({ selected: null, initialized: true });
  // Closing the diff is not asking for the first file again.
  expect(selectionAfter(files, null, true)).toEqual({ selected: null, initialized: true });
});

test("a list that is empty chooses nothing, and chooses once it holds a file", () => {
  expect(selectionAfter([], null, false)).toEqual({ selected: null, initialized: false });
  expect(selectionAfter([file("a.ts")], null, false)).toEqual({ selected: "a.ts", initialized: true });
});

const handlers = () => ({ openFile: vi.fn(), settle: vi.fn() });

test("the hook starts on the first file, follows the list, and lets the person choose and close", () => {
  const { openFile, settle } = handlers();
  const view = renderHook(({ state }) => useChangeSelection(state, undefined, { openFile, settle }), {
    initialProps: { state: ready("a.ts", "b.ts") as ChangesState | undefined },
  });
  expect(view.result.current.selected).toBe("a.ts");
  act(() => view.result.current.select("b.ts"));
  expect(view.result.current.selected).toBe("b.ts");
  view.rerender({ state: ready("b.ts", "c.ts") });
  expect(view.result.current.selected).toBe("b.ts");
  view.rerender({ state: ready("c.ts") });
  expect(view.result.current.selected).toBeNull();
  act(() => view.result.current.select(null));
  view.rerender({ state: ready("c.ts", "d.ts") });
  expect(view.result.current.selected).toBeNull();
});

test("a list that arrives after the hook has the first file chosen, even as React replays its updates", () => {
  const { openFile, settle } = handlers();
  const view = renderHook(({ state }) => useChangeSelection(state, undefined, { openFile, settle }), {
    initialProps: { state: undefined as ChangesState | undefined },
    wrapper: StrictMode,
  });
  expect(view.result.current.selected).toBeNull();
  view.rerender({ state: ready("a.ts", "b.ts") });
  expect(view.result.current.selected).toBe("a.ts");
});

test("a place asked for selects its file once the list holds it, and is settled", () => {
  const { openFile, settle } = handlers();
  const target = { workspaceId: 1, path: "b.ts", line: 4 };
  const view = renderHook(({ state, reveal }) => useChangeSelection(state, reveal, { openFile, settle }), {
    initialProps: {
      state: ready("a.ts", "b.ts") as ChangesState | undefined,
      reveal: undefined as typeof target | undefined,
    },
  });
  view.rerender({ state: ready("a.ts", "b.ts"), reveal: target });
  expect(view.result.current.selected).toBe("b.ts");
  expect(view.result.current.revealed).toBe(target);
  expect(openFile).not.toHaveBeenCalled();
  expect(settle).toHaveBeenCalledOnce();
});

test("a place whose file the list does not hold is opened in the file instead", () => {
  const { openFile, settle } = handlers();
  const target = { workspaceId: 1, path: "gone.ts", line: 2, threadId: 9 };
  renderHook(() => useChangeSelection(ready("a.ts"), target, { openFile, settle }));
  expect(openFile).toHaveBeenCalledWith("gone.ts", { line: 2, threadId: 9 });
  expect(settle).toHaveBeenCalled();
});

test("what is kept of reading a file that left the list is forgotten", () => {
  const { openFile, settle } = handlers();
  const view = renderHook(({ state }) => useChangeSelection(state, undefined, { openFile, settle }), {
    initialProps: { state: ready("a.ts", "b.ts") as ChangesState | undefined },
  });
  view.result.current.reading.positions.set("a.ts", 120);
  view.result.current.reading.positions.set("b.ts", 40);
  view.rerender({ state: ready("b.ts") });
  expect([...view.result.current.reading.positions.keys()]).toEqual(["b.ts"]);
});
