// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/index.css"), "utf8");
const rules = [...css.matchAll(/^\.chat-transcript-scrollbar[^{]*\{[^}]*\}/gm)].map((match) => match[0]).join("\n");
let style: HTMLStyleElement;
let viewport: HTMLDivElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = rules;
  document.head.append(style);
  viewport = document.createElement("div");
  viewport.className = "chat-transcript-scrollbar";
  viewport.style.overflowY = "auto";
  document.body.append(viewport);
});
afterEach(() => {
  viewport.remove();
  style.remove();
});

test.each([undefined, "start"])(
  "hides the scrollbar at the bottom, including between automatic scrolls (%s)",
  (edges) => {
    if (edges !== undefined) viewport.dataset.scrollable = edges;
    for (const autoscrolling of [true, false]) {
      viewport.toggleAttribute("data-autoscrolling", autoscrolling);
      const computed = getComputedStyle(viewport);
      expect(computed.getPropertyValue("scrollbar-color")).toBe("transparent transparent");
      expect(computed.getPropertyValue("scrollbar-gutter")).toBe("stable");
      expect(computed.overflowY).toBe("auto");
    }
  },
);

test.each(["end", "start end"])("shows a draggable scrollbar when reading history (%s)", (edges) => {
  viewport.dataset.scrollable = edges;
  expect(getComputedStyle(viewport).getPropertyValue("scrollbar-color")).toBe("var(--muted-foreground) transparent");
  viewport.setAttribute("data-autoscrolling", "");
  expect(getComputedStyle(viewport).getPropertyValue("scrollbar-color")).toBe("transparent transparent");
});

test("does not pass the hidden scrollbar color down to code blocks or tool output", () => {
  const content = document.createElement("div");
  viewport.append(content);
  expect(getComputedStyle(content).getPropertyValue("scrollbar-color")).toBe("auto");
});

test("includes the same visibility rules for WebKit scrollbar thumbs", () => {
  const thumbRules = [...(style.sheet?.cssRules ?? [])].filter(
    (rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule && rule.selectorText.endsWith("::-webkit-scrollbar-thumb"),
  );
  expect(thumbRules).toHaveLength(2);
  expect(thumbRules[0]?.style.background).toBe("transparent");
  expect(thumbRules[1]?.selectorText).toContain('[data-scrollable~="end"]:not([data-autoscrolling])');
  expect(thumbRules[1]?.style.background).toBe("var(--muted-foreground)");
});
