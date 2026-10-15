import { describe, expect, test } from "vitest";
import { formatCodeBlockTitle, parseFencedInfo } from "../src/chat/markdown.tsx";

describe("markdown code fence metadata parsing", () => {
  test("parses explicit language and filename correctly", () => {
    expect(parseFencedInfo("typescript:apps/web/src/app.ts")).toEqual({
      language: "typescript",
      filename: "apps/web/src/app.ts",
    });
    expect(parseFencedInfo("python")).toEqual({
      language: "python",
      filename: undefined,
    });
    expect(parseFencedInfo(undefined)).toEqual({
      language: undefined,
      filename: undefined,
    });
  });

  test("does not guess filename from comments in code content", () => {
    // Ensuring code content is not inspected for guessing filenames
    expect(parseFencedInfo("ts")).toEqual({
      language: "ts",
      filename: undefined,
    });
  });

  test("formats title appropriately for file paths and languages", () => {
    expect(formatCodeBlockTitle("src/main.rs", "rust")).toBe("src/main.rs");
    expect(formatCodeBlockTitle(undefined, "python")).toBe("Python");
    expect(formatCodeBlockTitle(undefined, "ts")).toBe("TypeScript");
    expect(formatCodeBlockTitle(undefined, "bash")).toBe("Bash");
    expect(formatCodeBlockTitle(undefined, "json")).toBe("JSON");
    expect(formatCodeBlockTitle(undefined, "unknown_lang")).toBe("Unknown_lang");
    expect(formatCodeBlockTitle(undefined, undefined)).toBe("Code");
    expect(formatCodeBlockTitle(undefined, "text")).toBe("Code");
  });
});
