import { describe, expect, test } from "vitest";
import {
  ADDITIONS_COLOR,
  countParts,
  DELETIONS_COLOR,
  statusColor,
  statusLabel,
  statusLetter,
} from "../src/changes/change-status.ts";

describe("change rows", () => {
  test("a status reads as the letter Git uses", () => {
    expect(statusLetter("modified")).toBe("M");
    expect(statusLetter("added")).toBe("A");
    expect(statusLetter("deleted")).toBe("D");
    expect(statusLetter("renamed")).toBe("R");
    expect(statusLetter("copied")).toBe("C");
    expect(statusLetter("typeChanged")).toBe("T");
    expect(statusLetter("conflicted")).toBe("U");
    expect(statusLetter("untracked")).toBe("?");
  });

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

  test("a letter is colored by what the change does", () => {
    expect(statusColor("added")).toBe(ADDITIONS_COLOR);
    expect(statusColor("untracked")).toBe(ADDITIONS_COLOR);
    expect(statusColor("deleted")).toBe(DELETIONS_COLOR);
    expect(ADDITIONS_COLOR).toContain("emerald");
    expect(DELETIONS_COLOR).toContain("red");
    expect(statusColor("renamed")).toContain("sky");
    expect(statusColor("conflicted")).toContain("amber");
    expect(statusColor("modified")).toContain("muted");
  });
});
