import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

describe("tab focus appearance", () => {
  test("keeps a visible keyboard focus outline independent of the active underline", () => {
    const rule = css.match(/^\[data-slot="tabs-trigger"\]:focus-visible\s*\{([^}]+)\}/m)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/outline:\s*2px solid var\(--ring\);/);
    expect(rule).toMatch(/outline-offset:\s*2px;/);
    expect(rule).not.toMatch(/outline:\s*none;/);
    expect(rule).not.toMatch(/(?:^|\s)(?:display|opacity):/);
  });
});
