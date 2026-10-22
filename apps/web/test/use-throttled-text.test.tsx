// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DRAW_INTERVAL_MS, useThrottledText } from "../src/chat/use-throttled-text.ts";

function Drawn({ text, streaming }: { text: string; streaming: boolean }) {
  return <p data-testid="drawn">{useThrottledText(text, streaming)}</p>;
}
const drawn = () => screen.getByTestId("drawn").textContent;
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("text that is not streaming is drawn at once, and whole", () => {
  const { rerender } = render(<Drawn text="one" streaming={false} />);
  expect(drawn()).toBe("one");
  rerender(<Drawn text="one two" streaming={false} />);
  expect(drawn()).toBe("one two");
});

test("while it streams it is drawn once an interval, with what has arrived by then", async () => {
  const { rerender } = render(<Drawn text="a" streaming />);
  expect(drawn()).toBe("a");
  for (const text of ["ab", "abc", "abcd"]) {
    rerender(<Drawn text={text} streaming />);
    await wait(10);
  }
  expect(drawn()).toBe("a");
  await wait(DRAW_INTERVAL_MS);
  expect(drawn()).toBe("abcd");
});

test("text that keeps arriving is still drawn each interval, and not only after it stops", async () => {
  const { rerender } = render(<Drawn text="0" streaming />);
  const seen: (string | null)[] = [];
  // A new character every 10ms for a second: a debounce would show nothing until the end.
  for (let i = 1; i <= 100; i++) {
    rerender(<Drawn text={String(i)} streaming />);
    await wait(10);
    if (i % 25 === 0) seen.push(drawn());
  }
  expect(seen.every((text) => text !== "0")).toBe(true);
  expect(Number(seen.at(-1))).toBeGreaterThan(Number(seen[0]));
  expect(Number(drawn())).toBeGreaterThan(90);
});

test("when the stream ends what arrived is drawn at once, without waiting for the interval", async () => {
  const { rerender } = render(<Drawn text="a" streaming />);
  rerender(<Drawn text="ab" streaming />);
  expect(drawn()).toBe("a");
  rerender(<Drawn text="abc" streaming={false} />);
  expect(drawn()).toBe("abc");
  await wait(DRAW_INTERVAL_MS * 2);
  expect(drawn()).toBe("abc");
});

test("a later stream starts from the text it has and not from an older one", async () => {
  const { rerender } = render(<Drawn text="old" streaming />);
  rerender(<Drawn text="finished text" streaming={false} />);
  rerender(<Drawn text="finished text, and more" streaming />);
  expect(drawn()).toBe("finished text");
  await wait(DRAW_INTERVAL_MS);
  expect(drawn()).toBe("finished text, and more");
});
