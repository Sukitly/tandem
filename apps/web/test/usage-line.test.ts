import { afterEach, describe, expect, test, vi } from "vitest";
import { paceOf } from "../src/chat/usage-line.tsx";

const NOW = new Date("2026-01-08T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => vi.useRealTimers());

/** A seven-day window that resets in `daysUntilReset` days from now. */
function window(utilization: number, daysUntilReset: number) {
  return {
    label: "7d",
    utilization,
    windowSeconds: 7 * 24 * 60 * 60,
    resetsAt: new Date(NOW.getTime() + daysUntilReset * DAY_MS).toISOString(),
  };
}

describe("the pace of a usage window", () => {
  test("is ahead when the share is past the elapsed part of the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Half the window is left, so 50% is on pace; 60% is ahead by ten points.
    expect(paceOf(window(60, 3.5))).toEqual({ diff: 10, ahead: true });
    expect(paceOf(window(30, 3.5))).toEqual({ diff: -20, ahead: false });
  });

  test("is nothing when the provider named no reset", () => {
    expect(paceOf({ label: "5h", utilization: 42, windowSeconds: 5 * 3600 })).toBeNull();
  });
});
