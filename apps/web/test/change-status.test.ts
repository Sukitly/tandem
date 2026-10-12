import { describe, expect, test } from "vitest";
import { countsLabel, statusColor, statusLabel, statusLetter } from "../src/changes/change-status.ts";

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

  test("only the counts a file has are shown", () => {
    expect(countsLabel(3, 1)).toBe("+3 −1");
    expect(countsLabel(0, 5)).toBe("−5");
    expect(countsLabel(2, 0)).toBe("+2");
    expect(countsLabel(0, 0)).toBe("");
    expect(countsLabel()).toBe("");
    expect(countsLabel(undefined, 4)).toBe("−4");
  });

  test("a letter is colored by what the change does", () => {
    expect(statusColor("added")).toContain("emerald");
    expect(statusColor("untracked")).toBe(statusColor("added"));
    expect(statusColor("deleted")).toContain("red");
    expect(statusColor("renamed")).toContain("sky");
    expect(statusColor("conflicted")).toContain("amber");
    expect(statusColor("modified")).toContain("muted");
  });
});
