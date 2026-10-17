// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/index.css"), "utf8");
const style = document.createElement("style");

afterEach(() => {
  style.remove();
  document.documentElement.classList.remove("dark");
});

test("native scrollbars and controls follow the app theme in both directions", () => {
  // Isolate the theme rules from Tailwind directives that require build-time processing.
  style.textContent = [...css.matchAll(/^(?::root|\.dark)\s*\{[^}]*\}/gm)].map((match) => match[0]).join("\n");
  document.head.append(style);
  const root = document.documentElement;

  expect(getComputedStyle(root).getPropertyValue("color-scheme")).toBe("light");
  root.classList.add("dark");
  expect(getComputedStyle(root).getPropertyValue("color-scheme")).toBe("dark");
  root.classList.remove("dark");
  expect(getComputedStyle(root).getPropertyValue("color-scheme")).toBe("light");
});
