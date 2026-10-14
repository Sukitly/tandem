// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Markdown } from "../src/chat/markdown.tsx";

vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({ workspaceId: 1, openFile: vi.fn() }),
}));
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
// The browser fixture in test/fixtures/markdown.html exercises the complete stylesheet and live updates.
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

describe("chat Markdown typography", () => {
  test.each([false, true])("uses a readable body and compact heading hierarchy (streaming: %s)", (streaming) => {
    const root = markdown("# First\n\nBody text.\n\n## Second\n\n### Third\n\n#### Fourth", streaming);
    expect(getComputedStyle(root).fontSize).toBe("1rem");
    expect(getComputedStyle(root).lineHeight).toBe("1.75");
    expect(getComputedStyle(element(root, "h1")).fontSize).toBe("1.25em");
    expect(getComputedStyle(element(root, "h2")).fontSize).toBe("1.125em");
    expect(getComputedStyle(element(root, "h3")).fontSize).toBe("1em");
    expect(getComputedStyle(element(root, "h4")).fontSize).toBe("1em");
  });

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

  test("spaces paragraphs and sections without adding gaps at the message boundaries", () => {
    const root = markdown("# First\n\nOne paragraph.\n\nAnother paragraph.\n\n## Next\n\nLast paragraph.");
    expect(getComputedStyle(element(root, "h1")).marginBlockStart).toBe("0");
    expect(getComputedStyle(element(root, "p")).marginBlock).toBe("0 1em");
    expect(getComputedStyle(element(root, "h2")).marginBlock).toBe("1.5em 0.5em");
    expect(getComputedStyle(element(root, ":scope > :last-child")).marginBlockEnd).toBe("0");
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
    expect(getComputedStyle(paragraph).marginBlock).toBe("0 1em");
  });

  test("aligns wrapped list text and keeps loose paragraphs and nested lists separate", () => {
    const root = markdown(
      "1. First item with `apps/server/src/services/prompt-templates.ts`.\n\n" +
        "   A second paragraph in the same item.\n\n" +
        "   - Nested item\n" +
        "   - Another nested item\n\n" +
        "2. Second item",
    );
    const ordered = element(root, "ol");
    const nested = element(root, "li > ul");
    expect(getComputedStyle(ordered).listStylePosition).toBe("outside");
    expect(getComputedStyle(ordered).paddingInlineStart).toBe("1.5em");
    expect(getComputedStyle(nested).listStylePosition).toBe("outside");
    expect(getComputedStyle(nested).marginBlock).toBe("0.5em 0");
    const paragraphs = root.querySelectorAll("ol > li:first-child > p");
    expect(paragraphs).toHaveLength(2);
    for (const paragraph of paragraphs) expect(getComputedStyle(paragraph).display).toBe("block");
    expect(getComputedStyle(element(root, "ol > li + li")).marginBlockStart).toBe("0.5em");
    expect(getComputedStyle(ordered).marginBlockEnd).toBe("0");
  });

  test("keeps long inline code quiet even inside emphasis, without styling fenced code", () => {
    const path = "apps/server/src/services/prompt-templates.ts";
    const root = markdown(
      `**Use \`${path}\`** and \`@earendil-works/pi-coding-agent\`.\n\n\`\`\`ts\nconst n = 1;\n\`\`\``,
    );
    const inline = element(root, '[data-streamdown="inline-code"]');
    const style = getComputedStyle(inline);
    expect(inline.textContent).toBe(path);
    expect(style.fontSize).toBe("0.875em");
    expect(style.fontWeight).toBe("400");
    expect(style.overflowWrap).toBe("anywhere");
    expect(style.boxDecorationBreak).toBe("clone");
    expect(getComputedStyle(element(root, '[data-streamdown="strong"]')).fontWeight).toBe("600");
    const fence = element(root, "pre code");
    expect(fence.textContent).toBe("const n = 1;");
    expect(fence.hasAttribute("data-streamdown")).toBe(false);
    expect(element(root, "pre").classList.contains("overflow-x-auto")).toBe(true);
    expect(element(root, '[aria-label="Copy code"]')).toBeDefined();
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

  test.each([false, true])("uses one table surface without a height cap (streaming: %s)", (streaming) => {
    const root = markdown(
      "| File | Purpose |\n| --- | --- |\n| `apps/server/src/services/prompt-templates.ts` | Loads templates |",
      streaming,
    );
    const wrapper = element(root, '[data-streamdown="table-wrapper"]');
    expect(getComputedStyle(wrapper).display).toBe("block");
    expect(getComputedStyle(wrapper).padding).toBe("0px");
    const actions = element(wrapper, ":scope > :first-child");
    expect(getComputedStyle(actions).position).toBe("absolute");
    expect(actions.querySelectorAll("button")).toHaveLength(3);
    const scroll = element(wrapper, ":scope > :last-child");
    // Streamdown normalizes "none" to an absent height limit.
    expect(scroll.style.maxHeight).toBe("");
    expect(getComputedStyle(scroll).overflowX).toBe("auto");
    expect(getComputedStyle(element(root, "td")).verticalAlign).toBe("top");
    expect(getComputedStyle(element(root, "th")).whiteSpace).toBe("normal");
    expect(getComputedStyle(element(root, "td code")).padding).toBe("0px");
  });

  test("uses upright quotes and removes the final paragraph gap", () => {
    const root = markdown("> First paragraph.\n>\n> Second paragraph.");
    expect(getComputedStyle(element(root, "blockquote")).fontStyle).toBe("normal");
    expect(getComputedStyle(element(root, "blockquote > :last-child")).marginBlockEnd).toBe("0");
  });

  test("only hides actions on devices with hover and keeps keyboard focus visible", () => {
    const root = markdown("```ts\nconst n = 1;\n```");
    const button = element(root, '[aria-label="Copy code"]');
    expect(button.classList.contains("opacity-0")).toBe(false);
    expect(button.classList.contains("[@media(hover:hover)]:opacity-0")).toBe(true);
    expect(button.classList.contains("focus-visible:opacity-100")).toBe(true);
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain(":is(:hover, :focus-within)");
  });

  test("uses theme variables for inline code and leaves Markdown outside chat untouched", () => {
    expect(css).toContain("color-mix(in oklab, var(--muted) 65%, transparent)");
    markdown("A paragraph.");
    const outside = document.createElement("code");
    outside.dataset.streamdown = "inline-code";
    document.body.append(outside);
    expect(getComputedStyle(outside).boxDecorationBreak).not.toBe("clone");
  });
});
