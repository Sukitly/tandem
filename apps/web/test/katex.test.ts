import katex from "katex";
import { expect, test } from "vitest";

test("KaTeX ignores inherited trust settings rather than treating them as explicit permission", () => {
  const formula = "\\href{https://example.com}{link}";
  // A polluted prototype must not enable trusted commands. Do not pollute the test process's Object.prototype.
  const inherited = Object.create({ trust: true });
  expect(katex.renderToString(formula, inherited)).not.toContain('href="https://example.com"');
  expect(katex.renderToString(formula, { trust: true })).toContain('href="https://example.com"');
});
