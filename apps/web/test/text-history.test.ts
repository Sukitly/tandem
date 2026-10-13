import { afterEach, describe, expect, test, vi } from "vitest";
import { TextHistory, type TextSnapshot } from "../src/chat/text-history.ts";

function snapshot(value: string): TextSnapshot {
  return { value, start: value.length, end: value.length, direction: "none" };
}

afterEach(() => vi.useRealTimers());

describe("composer text history", () => {
  test("undo and redo restore text and selection", () => {
    const history = new TextHistory();
    const before: TextSnapshot = { value: "hello", start: 1, end: 4, direction: "backward" };
    const after = snapshot("ho");
    history.record(before, after);
    expect(history.undo(after)).toEqual(before);
    expect(history.redo(before)).toEqual(after);
  });

  test("typing is grouped until a pause, movement, or programmatic edit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    const history = new TextHistory();
    history.record(snapshot(""), snapshot("h"), true);
    history.record(snapshot("h"), snapshot("hi"), true);
    expect(history.undo(snapshot("hi"))).toEqual(snapshot(""));
    history.redo(snapshot(""));
    vi.advanceTimersByTime(1001);
    history.record(snapshot("hi"), snapshot("hi!"), true);
    expect(history.undo(snapshot("hi!"))).toEqual(snapshot("hi"));
    history.redo(snapshot("hi"));
    history.breakTyping();
    history.record(snapshot("hi!"), snapshot("hi!!"), true);
    expect(history.undo(snapshot("hi!!"))).toEqual(snapshot("hi!"));
    history.record(snapshot("hi!"), snapshot("hi"));
    expect(history.undo(snapshot("hi"))).toEqual(snapshot("hi!"));
  });

  test("no-op changes preserve redo while new edits discard it", () => {
    const history = new TextHistory();
    history.record(snapshot(""), snapshot("a"));
    history.undo(snapshot("a"));
    history.record(snapshot(""), snapshot(""));
    expect(history.redo(snapshot(""))).toEqual(snapshot("a"));
    history.undo(snapshot("a"));
    history.record(snapshot(""), snapshot("b"));
    expect(history.redo(snapshot("b"))).toBeNull();
  });

  test("history is bounded and reset discards old messages", () => {
    const history = new TextHistory();
    for (let i = 0; i < 101; i++) history.record(snapshot(`${i}`), snapshot(`${i + 1}`));
    let current = snapshot("101");
    for (let i = 0; i < 100; i++) current = history.undo(current) ?? current;
    expect(current.value).toBe("1");
    expect(history.undo(current)).toBeNull();
    history.clear();
    expect(history.redo(current)).toBeNull();
  });
});
