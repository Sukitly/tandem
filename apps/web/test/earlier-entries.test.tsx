// @vitest-environment jsdom
import type { Conversation, ConversationHistory, ConversationView } from "@tandem/contracts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useEarlierEntries } from "../src/chat/use-earlier-entries.ts";

const reported = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/errors.ts", () => ({ reportFailure: reported }));

afterEach(() => {
  cleanup();
  reported.mockReset();
});

type Entry = ConversationView["entries"][number];
const entry = (id: number, kind = "pi.user") => ({ id, kind, model: [] }) as unknown as Entry;

function view(entries: Entry[], conversationId = 1): ConversationView {
  return { conversation: { id: conversationId }, entries, docs: {} } as unknown as ConversationView;
}

/** A conversation whose history is entries 1 to 4, a page at a time, as the server gives them. */
function conversationWith(history: (input: { before: number; limit?: number }) => Promise<ConversationHistory>) {
  const spy = vi.fn(history);
  return { conversation: { history: spy } as unknown as Conversation, history: spy };
}

const stored = [entry(1), entry(2), entry(3), entry(4)];
function pages(size: number) {
  return async ({ before }: { before: number }): Promise<ConversationHistory> => {
    const older = stored.filter((candidate) => candidate.id < before);
    return { entries: older.slice(-size), more: older.length > size };
  };
}
const compacted = view([entry(9, "pi.compaction"), entry(5), entry(6)]);

test("there is nothing to fetch while no compaction has left anything out of the view", () => {
  const { conversation } = conversationWith(pages(2));
  const { result } = renderHook(() => useEarlierEntries(conversation, view([entry(1), entry(2)])));
  expect(result.current).toBeUndefined();
});

test("starts empty with more to fetch, then fetches the page before the first entry the compaction kept", async () => {
  const { conversation, history } = conversationWith(pages(2));
  const { result } = renderHook(() => useEarlierEntries(conversation, compacted));
  expect(result.current).toMatchObject({ entries: [], more: true, loading: false });

  act(() => result.current?.load());
  expect(result.current?.loading).toBe(true);
  await waitFor(() => expect(result.current?.loading).toBe(false));
  expect(history).toHaveBeenCalledWith({ before: 5 }, expect.anything());
  expect(result.current?.entries.map((e) => e.id)).toEqual([3, 4]);
  expect(result.current?.more).toBe(true);
});

test("the next page goes before the first entry fetched, and the last one says there is no more", async () => {
  const { conversation, history } = conversationWith(pages(2));
  const { result } = renderHook(() => useEarlierEntries(conversation, compacted));
  act(() => result.current?.load());
  await waitFor(() => expect(result.current?.loading).toBe(false));
  act(() => result.current?.load());
  await waitFor(() => expect(result.current?.loading).toBe(false));
  expect(history).toHaveBeenLastCalledWith({ before: 3 }, expect.anything());
  expect(result.current?.entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  expect(result.current?.more).toBe(false);
});

test("a request already under way is not asked again", async () => {
  const { conversation, history } = conversationWith(pages(2));
  const { result } = renderHook(() => useEarlierEntries(conversation, compacted));
  act(() => {
    result.current?.load();
    result.current?.load();
  });
  await waitFor(() => expect(result.current?.loading).toBe(false));
  expect(history).toHaveBeenCalledTimes(1);
});

test("a later compaction has replaced more, so what was fetched is dropped", async () => {
  const { conversation } = conversationWith(pages(2));
  const { result, rerender } = renderHook(({ current }) => useEarlierEntries(conversation, current), {
    initialProps: { current: compacted },
  });
  act(() => result.current?.load());
  await waitFor(() => expect(result.current?.entries).toHaveLength(2));
  rerender({ current: view([entry(12, "pi.compaction"), entry(6)]) });
  expect(result.current).toMatchObject({ entries: [], more: true });
});

test("a failure is reported, and the button can be pressed again", async () => {
  const { conversation } = conversationWith(async () => {
    throw new Error("offline");
  });
  const { result } = renderHook(() => useEarlierEntries(conversation, compacted));
  act(() => result.current?.load());
  await waitFor(() => expect(reported).toHaveBeenCalledWith("Could not load earlier messages", expect.any(Error)));
  await waitFor(() => expect(result.current?.loading).toBe(false));
  expect(result.current).toMatchObject({ entries: [], more: true });
});
