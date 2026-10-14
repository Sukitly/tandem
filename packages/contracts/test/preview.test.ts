import { describe, expect, test } from "vitest";
import { parsePreviewTarget, previewPath, previewUrl } from "../src/preview.ts";

describe("preview contracts", () => {
  test("previewPath formats subpath correctly", () => {
    expect(previewPath(3000)).toBe("/preview/3000/");
    expect(previewPath(5173)).toBe("/preview/5173/");
  });

  test("previewUrl generates subpath or subdomain url", () => {
    expect(previewUrl({ port: 3000, baseUrl: "http://127.0.0.1:4820" })).toBe("http://127.0.0.1:4820/preview/3000/");
    expect(previewUrl({ port: 3000, baseUrl: "http://localhost:4820", useSubdomain: true })).toBe(
      "http://localhost:4820/preview/3000/",
    );
    expect(previewUrl({ port: 5173, baseUrl: "https://tandem.example.com", useSubdomain: true })).toBe(
      "https://5173--tandem.example.com/",
    );
  });

  test("parsePreviewTarget handles subpath", () => {
    const allowed = new Set(["tandem.example.com"]);
    expect(parsePreviewTarget(undefined, "/preview/5173/", allowed)).toEqual({
      port: 5173,
      path: "/",
    });
    expect(parsePreviewTarget("tandem.example.com", "/preview/3000/assets/main.js?v=1", allowed)).toEqual({
      port: 3000,
      path: "/assets/main.js?v=1",
    });
    expect(parsePreviewTarget("tandem.example.com", "/preview/not-a-port", allowed)).toBeUndefined();
    expect(parsePreviewTarget("tandem.example.com", "/other/path", allowed)).toBeUndefined();
  });

  test("parsePreviewTarget handles subdomain", () => {
    const allowed = new Set(["tandem.example.com"]);
    expect(parsePreviewTarget("5173--tandem.example.com", "/assets/main.js", allowed)).toEqual({
      port: 5173,
      path: "/assets/main.js",
    });
    expect(parsePreviewTarget("5173--unknown.com", "/assets/main.js", allowed)).toBeUndefined();
    expect(parsePreviewTarget("notport--tandem.example.com", "/assets/main.js", allowed)).toBeUndefined();
  });
});
