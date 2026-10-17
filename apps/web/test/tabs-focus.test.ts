import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

describe("focus appearance", () => {
  test("suppresses added focus rings without removing ordinary shadows or invalid-state feedback", () => {
    expect(css).toContain(':focus-visible:not([aria-invalid="true"]):not(:has([aria-invalid="true"]))');
    expect(css).toContain('[data-slot="input-group"]:focus-within:not(:has([aria-invalid="true"]))');
    expect(css).toContain("box-shadow: var(--tw-shadow, 0 0 #0000);");
    expect(css).toContain("outline: none;");
    expect(css).not.toContain("outline: 2px solid var(--ring)");
  });
});
