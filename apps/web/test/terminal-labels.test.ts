import { clampTerminalSize, exitLabel } from "@tandem/contracts";
import { describe, expect, test } from "vitest";

describe("a terminal's end", () => {
  test("shows the exit code of a shell that exited", () => {
    expect(exitLabel({ code: 3 })).toBe("Exited 3");
    expect(exitLabel({ code: 0 })).toBe("Exited 0");
  });

  test("shows the signal of a shell a signal ended, not its exit code of 0", () => {
    expect(exitLabel({ code: 0, signal: 9 })).toBe("Killed (signal 9)");
  });
});

describe("a terminal's size", () => {
  test("is clamped to what a terminal can be, in whole cells", () => {
    expect(clampTerminalSize({ cols: 0, rows: 0 })).toEqual({ cols: 2, rows: 1 });
    expect(clampTerminalSize({ cols: 5000, rows: 900 })).toEqual({ cols: 1000, rows: 500 });
    expect(clampTerminalSize({ cols: 120.7, rows: 40.2 })).toEqual({ cols: 120, rows: 40 });
  });
});
