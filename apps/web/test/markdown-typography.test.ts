// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Markdown } from "../src/chat/markdown.tsx";

vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ workspaceId: 1, openFile: vi.fn() })),
);
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ workspaces: { state: {} } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: () => ({ workspaces: [{ id: 1, path: "/project" }] }),
}));

// Exercise Streamdown's real error UI without loading Mermaid's parser in jsdom.
vi.mock("@streamdown/mermaid", () => ({
  mermaid: {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: () => ({
      initialize: () => {},
      render: async () => {
        throw new Error("Invalid diagram");
      },
    }),
  },
}));

// These tests check local selectors and rendered structure, not Tailwind's full cascade or browser layout.
const css = readFileSync(resolve(import.meta.dirname, "../src/chat/markdown.css"), "utf8");
let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  style.remove();
  document.body.replaceChildren();
});

function markdown(text: string, streaming = false): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(createElement(Markdown, { text, streaming }));
  const root = document.querySelector<HTMLElement>(".chat-markdown");
  if (root === null) throw new Error("The chat typography scope is missing");
  return root;
}

function element(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Missing Markdown element: ${selector}`);
  return found;
}

describe("chat Markdown", () => {
  test("renders inline and display math through Streamdown with the patched KaTeX dependency", () => {
    const root = markdown("Area \\(\\pi r^2\\)\n\n\\[ \\frac{1}{2} + \\sqrt{x} \\]");
    expect(root.querySelectorAll(".katex")).toHaveLength(2);
    expect(root.querySelector(".katex-display")).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(root.querySelectorAll("math")).toHaveLength(2);
  });

  test("math cannot create trusted links or load external images", () => {
    const root = markdown(
      "\\[ \\href{javascript:alert(1)}{click} \\]\n\n\\[ \\includegraphics{https://evil.example/track} \\]",
    );
    expect(root.querySelector("a, img, script")).toBeNull();
  });

  test("only marks Markdown paragraphs and preserves image and fenced block wrappers", () => {
    const root = markdown(
      "A paragraph.\n\n> A quoted paragraph.\n\n![Chart](https://example.com/chart.png)\n\n```ts\nconst n = 1;\n```",
    );
    const paragraphs = root.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    for (const paragraph of paragraphs) expect(paragraph.dataset.chatMarkdown).toBe("paragraph");
    expect(element(root, "img").closest("p")).toBeNull();
    expect(element(root, "pre").closest("p")).toBeNull();
  });

  test("leaves Mermaid error paragraphs unmarked and without chat paragraph spacing", async () => {
    // Streamdown defers diagram rendering until its container becomes visible.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        callback: (entries: { isIntersecting: boolean }[]) => void;
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          this.callback = callback;
        }
        observe() {
          this.callback([{ isIntersecting: true }]);
        }
        takeRecords() {
          return [];
        }
        disconnect() {}
      },
    );
    render(createElement(Markdown, { text: "A paragraph.\n\n```mermaid\ninvalid\n```" }));
    const error = await screen.findByText(/Mermaid Error: Invalid diagram/);
    expect(error.tagName).toBe("P");
    expect(error.hasAttribute("data-chat-markdown")).toBe(false);
    expect(getComputedStyle(error).marginBlock).toBe("");
    const diagram = element(document.body, '[data-streamdown="mermaid-block"]');
    expect(getComputedStyle(element(diagram, ":scope > :first-child")).display).toBe("none");
    expect(getComputedStyle(diagram).padding).toBe("0px");
    expect(element(diagram, '[data-streamdown="mermaid-block-actions"]')).toBeDefined();
    const paragraph = element(document.body, '[data-chat-markdown="paragraph"]');
    expect(getComputedStyle(paragraph).marginBlock).toBe("0 1rem");
  });

  test("preserves file links, hard line breaks, task lists, and untrusted Markdown handling", () => {
    const root = markdown(
      "[source](src/app.ts#L12)\nNext line\n\n- [x] Done\n- [ ] Pending\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))",
    );
    expect(element(root, 'button[title="src/app.ts:12"]').textContent).toBe("source");
    expect(root.querySelector("br")).not.toBeNull();
    expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
