import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

function lightness(block: string, token: string): number {
  const match = block.match(new RegExp(`--${token}:\\s*oklch\\(([\\d.]+) 0 0\\)`));
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe("sidebar hover and current conversation colors", () => {
  test("uses a noticeably darker shared accent against the light sidebar", () => {
    const block = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(lightness(block, "sidebar") - lightness(block, "sidebar-accent")).toBeGreaterThanOrEqual(0.04);
  });

  test("keeps a stronger shared accent contrast against the dark sidebar", () => {
    const block = css.match(/\.dark\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(lightness(block, "sidebar-accent") - lightness(block, "sidebar")).toBeGreaterThanOrEqual(0.1);
  });
});
