import { describe, expect, test } from "vitest";
import { countLines } from "../src/files/file-view.tsx";

describe("countLines", () => {
  test("counts lines in text files accurately", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("\n")).toBe(1);
    expect(countLines("console.log(1);")).toBe(1);
    expect(countLines("console.log(1);\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
  });
});
