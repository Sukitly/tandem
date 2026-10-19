import { clampTerminalSize } from "@tandem/contracts";
import { describe, expect, test } from "vitest";

describe("a terminal's size", () => {
  test("is clamped to what a terminal can be, in whole cells", () => {
    expect(clampTerminalSize({ cols: 0, rows: 0 })).toEqual({ cols: 2, rows: 1 });
    expect(clampTerminalSize({ cols: 5000, rows: 900 })).toEqual({ cols: 1000, rows: 500 });
    expect(clampTerminalSize({ cols: 120.7, rows: 40.2 })).toEqual({ cols: 120, rows: 40 });
  });
});
