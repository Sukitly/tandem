import { expect, test } from "vitest";
import { PREVIEW_SANDBOX_TOKENS } from "../src/preview.ts";

test("preview capabilities remain restricted and immutable", () => {
  expect(PREVIEW_SANDBOX_TOKENS).toEqual(["allow-scripts", "allow-forms", "allow-popups", "allow-modals"]);
  expect(Object.isFrozen(PREVIEW_SANDBOX_TOKENS)).toBe(true);
  expect(PREVIEW_SANDBOX_TOKENS).not.toContain("allow-same-origin");
  expect(PREVIEW_SANDBOX_TOKENS).not.toContain("allow-popups-to-escape-sandbox");
});
