import { describe, expect, test } from "vitest";
import { parsePreviewTarget } from "../src/preview.ts";

describe("preview contracts", () => {
  test("parsePreviewTarget handles subpath with allowed host", () => {
    const allowed = new Set(["tandem.example.com", "localhost:4820"]);
    expect(parsePreviewTarget("tandem.example.com", "/preview/5173/", allowed)).toEqual({
      port: 5173,
      path: "/",
    });
    expect(parsePreviewTarget("localhost:4820", "/preview/3000/assets/main.js?v=1", allowed)).toEqual({
      port: 3000,
      path: "/assets/main.js?v=1",
    });
    // Missing or disallowed host
    expect(parsePreviewTarget(undefined, "/preview/5173/", allowed)).toBeUndefined();
    expect(parsePreviewTarget("evil.com", "/preview/5173/", allowed)).toBeUndefined();
    // Invalid port or non-preview path
    expect(parsePreviewTarget("tandem.example.com", "/preview/not-a-port", allowed)).toBeUndefined();
    expect(parsePreviewTarget("tandem.example.com", "/other/path", allowed)).toBeUndefined();
  });
});
