import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

describe("tab focus appearance", () => {
  test("removes the focus border, ring, and outline outside the utility layers", () => {
    const rule = css.match(/^\[data-slot="tabs-trigger"\]:focus-visible\s*\{([^}]+)\}/m)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/border-color:\s*transparent;/);
    expect(rule).toMatch(/box-shadow:\s*none;/);
    expect(rule).toMatch(/outline:\s*none;/);
    expect(rule).not.toMatch(/(?:^|\s)(?:display|opacity):/);
  });
});
