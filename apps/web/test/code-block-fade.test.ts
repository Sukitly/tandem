// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { CodeBlock, CodeBlockContent } from "../src/components/ui/code-block.tsx";

const css = readFileSync(resolve(import.meta.dirname, "../src/index.css"), "utf8");
const rule = css.match(/\[data-slot="code-block-content"\]\s*\{[^}]+\}/)?.[0];
let style: HTMLStyleElement | undefined;

afterEach(() => {
  cleanup();
  style?.remove();
});

test.each([false, true])("code blocks disable edge fading without losing scrolling (wrap: %s)", (wrap) => {
  expect(rule).toBeDefined();
  expect(rule).toContain("-webkit-mask-image: none");
  style = document.createElement("style");
  style.textContent = rule ?? "";
  document.head.append(style);

  const { container } = render(
    createElement(CodeBlock, null, createElement(CodeBlockContent, { wrap }, "long code line ".repeat(100))),
  );
  const content = container.querySelector<HTMLElement>("[data-slot=code-block-content]");
  if (content === null) throw new Error("Missing code block content");
  const computed = getComputedStyle(content);
  expect(computed.maskImage).toBe("none");
  expect(computed.animation).toBe("none");
  expect(content.classList.contains("overflow-auto")).toBe(true);
  expect(content.classList.contains("scrollbar-thin")).toBe(true);
});
