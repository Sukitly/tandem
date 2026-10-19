import { describe, expect, test } from "vitest";
import { countParts, statusLabel } from "../src/changes/change-status.ts";

describe("change rows", () => {
  test("a rename says where the file came from", () => {
    expect(statusLabel("modified")).toBe("modified");
    expect(statusLabel("typeChanged")).toBe("type changed");
    expect(statusLabel("untracked")).toBe("untracked");
    expect(statusLabel("renamed", "old.ts")).toBe("renamed from old.ts");
  });

  test("only the counts a file has are shown, additions and deletions apart", () => {
    expect(countParts(3, 1)).toEqual([
      { kind: "additions", text: "+3" },
      { kind: "deletions", text: "−1" },
    ]);
    expect(countParts(0, 5)).toEqual([{ kind: "deletions", text: "−5" }]);
    expect(countParts(2, 0)).toEqual([{ kind: "additions", text: "+2" }]);
    expect(countParts(0, 0)).toEqual([]);
    expect(countParts()).toEqual([]);
    expect(countParts(undefined, 4)).toEqual([{ kind: "deletions", text: "−4" }]);
  });
});
