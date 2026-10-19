// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { reloaded, syncSessions, usePreviewSessions } from "../src/preview/preview-sessions.ts";

const sessions = (...entries: [number, number][]) => new Map(entries);

test("the port shown while the panel is in use gets a frame, and one shown while it is not does not", () => {
  expect(syncSessions(sessions(), [3000, 5173], 3000, true)).toEqual(sessions([3000, 0]));
  expect(syncSessions(sessions(), [3000, 5173], 3000, false)).toEqual(sessions());
  expect(syncSessions(sessions(), [], null, true)).toEqual(sessions());
});

test("a port that was visited keeps its frame, hidden, while another is shown", () => {
  const visited = syncSessions(sessions(), [3000, 5173], 3000, true);
  const both = syncSessions(visited, [3000, 5173], 5173, true);
  expect(both).toEqual(sessions([3000, 0], [5173, 0]));
  // Away from the panel, nothing is added but nothing is lost.
  expect(syncSessions(both, [3000, 5173], 3000, false)).toEqual(both);
});

test("a port that is gone loses its frame, and what is the same is returned as it was", () => {
  const before = sessions([3000, 2], [5173, 0]);
  expect(syncSessions(before, [5173], 5173, true)).toEqual(sessions([5173, 0]));
  expect(syncSessions(before, [3000, 5173], 3000, true)).toBe(before);
});

test("a reload advances only that port's frame", () => {
  const before = sessions([3000, 0], [5173, 4]);
  const after = reloaded(before, 3000);
  expect(after).toEqual(sessions([3000, 1], [5173, 4]));
  expect(before.get(3000)).toBe(0);
  expect(reloaded(after, 3000).get(3000)).toBe(2);
});

test("the hook follows the ports and the panel, and reloads one frame", () => {
  const view = renderHook(({ ports, current, active }) => usePreviewSessions(ports, current, active), {
    initialProps: { ports: [3000], current: 3000 as number | null, active: false },
  });
  expect(view.result.current.sessions.size).toBe(0);
  view.rerender({ ports: [3000], current: 3000, active: true });
  expect([...view.result.current.sessions]).toEqual([[3000, 0]]);
  act(() => view.result.current.reload(3000));
  expect([...view.result.current.sessions]).toEqual([[3000, 1]]);
  view.rerender({ ports: [], current: null, active: true });
  expect(view.result.current.sessions.size).toBe(0);
});
