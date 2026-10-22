// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
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
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => ({ svg: `<svg data-source="${source}"></svg>` })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

/** The markup of a message, as a document. It has no effects: no diagram is drawn and nothing is highlighted. */
function markdown(text: string, streaming = false): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(<Markdown text={text} streaming={streaming} />);
  const root = document.querySelector<HTMLElement>('[data-slot="markdown"]');
  if (root === null) throw new Error("The Markdown root is missing");
  return root;
}

function element(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Missing Markdown element: ${selector}`);
  return found;
}

describe("math", () => {
  test("is drawn inline and displayed by KaTeX, with the patched dependency", () => {
    const root = markdown("Area \\(\\pi r^2\\)\n\n\\[ \\frac{1}{2} + \\sqrt{x} \\]");
    expect(root.querySelectorAll(".katex")).toHaveLength(2);
    expect(root.querySelector(".katex-display")).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(root.querySelectorAll("math")).toHaveLength(2);
  });

  test("cannot create trusted links or load external images", () => {
    const root = markdown(
      "\\[ \\href{javascript:alert(1)}{click} \\]\n\n\\[ \\includegraphics{https://evil.example/track} \\]",
    );
    expect(root.querySelector("a, img, script")).toBeNull();
  });

  test("a single dollar sign is a dollar sign", () => {
    const root = markdown("It costs $5, or $6 for two.");
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toContain("It costs $5, or $6 for two.");
  });
});

describe("untrusted Markdown", () => {
  test("keeps file links, hard line breaks and task lists, and shows raw HTML as text", () => {
    const root = markdown(
      "[source](src/app.ts#L12)\nNext line\n\n- [x] Done\n- [ ] Pending\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))",
    );
    expect(element(root, 'button[title="src/app.ts:12"]').textContent).toBe("source");
    expect(root.querySelector("br")).not.toBeNull();
    expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(root.textContent).toContain("unsafe");
  });

  test("a link to a file with no folder keeps its line, which react-markdown would have emptied", () => {
    const root = markdown("[one](app.ts:12) and [two](README.md#L3) and [three](src/app.ts:12:5)");
    // A column is not part of the place a file opens at.
    expect([...root.querySelectorAll("button")].map((button) => button.title)).toEqual([
      "app.ts:12",
      "README.md:3",
      "src/app.ts:12",
    ]);
    expect(root.querySelector("a")).toBeNull();
  });

  test("a link to the web opens in a new tab, and one to mail does not", () => {
    const root = markdown("[site](https://example.com/a?b=1) and [mail](mailto:a@b.co)");
    const [site, mail] = [...root.querySelectorAll("a")];
    expect(site?.getAttribute("href")).toBe("https://example.com/a?b=1");
    expect(site?.getAttribute("target")).toBe("_blank");
    expect(site?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(mail?.getAttribute("href")).toBe("mailto:a@b.co");
    expect(mail?.hasAttribute("target")).toBe(false);
  });

  test("other schemes are never a link, whichever way they are written", () => {
    const root = markdown(
      "[a](javascript:alert(1)) [b](vscode://x) [c](data:text/html,x) [d][r] <a href='javascript:alert(2)'>e</a>\n\n[r]: javascript:alert(3)",
    );
    // The `<a>` written out is text, which is safe: no element has an address.
    expect(root.querySelector("a, [href], [src]")).toBeNull();
    expect(root.textContent).toContain("<a href='javascript:alert(2)'>e</a>");
  });

  test("images load only from the web; others show as their text", () => {
    const root = markdown("![chart](https://example.com/a.png) ![secret](/etc/passwd) ![](data:image/png;base64,AA==)");
    expect([...root.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      "https://example.com/a.png",
    ]);
    expect(root.textContent).toContain("secret");
  });

  test("a table has no buttons of its own", () => {
    const root = markdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(root.querySelectorAll("table")).toHaveLength(1);
    expect(root.querySelector("button")).toBeNull();
  });
});

describe("Chinese, Japanese and Korean text", () => {
  test("emphasis and strikethrough next to their punctuation are recognized", () => {
    const root = markdown("他说**“你好。”**然后走了，价格是~~100元。~~折扣");
    expect(element(root, "strong").textContent).toBe("“你好。”");
    expect(element(root, "del").textContent).toBe("100元。");
  });

  test("an address ends at the punctuation, which is text, and the address after it is a link too", () => {
    const root = markdown("见 https://example.com。然后看 https://example.org/a，好。");
    expect([...root.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com",
      "https://example.org/a",
    ]);
    expect(root.textContent).toBe("见 https://example.com。然后看 https://example.org/a，好。");
  });

  test("ASCII text is unchanged", () => {
    const root = markdown("It is **bold**, and https://example.com. is a link before the stop.");
    expect(element(root, "strong").textContent).toBe("bold");
    expect(element(root, "a").getAttribute("href")).toBe("https://example.com");
  });
});

describe("code", () => {
  test("a fence is a code panel titled by its language, or by the file written after it", () => {
    const root = markdown("```ts\nconst n = 1\n```\n\n```ts:src/app.ts\nconst m = 2\n```\n\n```\nplain\n```");
    expect([...root.querySelectorAll("[data-slot=code-block-title]")].map((title) => title.textContent)).toEqual([
      "ts",
      "src/app.ts",
      "text",
    ]);
  });

  test("inline code is not a panel", () => {
    const root = markdown("Use `bun run check` here.");
    expect(element(root, "code").textContent).toBe("bun run check");
    expect(root.querySelector("[data-slot=code-block]")).toBeNull();
  });
});

describe("streaming", () => {
  test("syntax that has not closed yet is formatting, not raw characters, while the text arrives", () => {
    expect(markdown("A **half-writ", true).querySelector("strong")?.textContent).toBe("half-writ");
    expect(markdown("A **half-writ", false).querySelector("strong")).toBeNull();
  });
});

describe("a diagram", () => {
  const fence = "Before.\n\n```mermaid\ngraph TD; A-->B\n```\n\nAfter.";

  test("is the source as a code panel while the text arrives, and is not drawn", async () => {
    mermaid.render.mockClear();
    render(<Markdown text={fence} streaming />);
    expect(screen.getByText(/graph TD; A-->B/)).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(document.querySelector("svg[data-source]")).toBeNull();
  });

  test("is drawn once the text is whole, in the place of its source", async () => {
    mermaid.render.mockClear();
    render(<Markdown text={fence} />);
    await waitFor(() => expect(document.querySelector("svg[data-source]")).not.toBeNull());
    expect(mermaid.render).toHaveBeenCalledOnce();
    expect(document.querySelector("svg[data-source]")?.getAttribute("data-source")).toBe("graph TD; A-->B");
    expect(screen.queryByText(/graph TD; A-->B/)).toBeNull();
    expect(screen.getByText("Before.")).toBeDefined();
    expect(screen.getByText("After.")).toBeDefined();
  });

  test("a fence of another language is untouched by it", () => {
    mermaid.render.mockClear();
    const root = markdown("```ts\nconst n = 1\n```");
    expect(root.querySelector("[data-slot=code-block]")).not.toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
