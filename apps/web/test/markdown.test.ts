import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, test } from "vitest";
import { texDelimiters } from "../src/chat/tex-delimiters.ts";
import { untrustedMarkdown } from "../src/chat/untrusted-markdown.ts";

// As in `Markdown`: GFM, remark-math as Streamdown configures it, then Tandem's plugins.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false })
  .use(texDelimiters)
  .use(untrustedMarkdown);

function parse(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}

/** Every node of a type, in document order. */
function all<T extends RootContent["type"]>(tree: Root, type: T): Extract<RootContent, { type: T }>[] {
  const found: RootContent[] = [];
  const walk = (node: Root | RootContent): void => {
    if (node.type === type) found.push(node as RootContent);
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(tree);
  return found as Extract<RootContent, { type: T }>[];
}

function math(markdown: string): { value: string; display: boolean }[] {
  return all(parse(markdown), "inlineMath").map((node) => ({
    value: node.value,
    display: node.data?.hName === "pre",
  }));
}

function text(markdown: string): string {
  return all(parse(markdown), "text")
    .map((node) => node.value)
    .join("");
}

describe("TeX delimiters", () => {
  test("\\(…\\) is inline math and \\[…\\] displayed math", () => {
    expect(math("Area \\(\\pi r^2\\) and\n\n\\[ E = mc^2 \\]")).toEqual([
      { value: "\\pi r^2", display: false },
      { value: " E = mc^2 ", display: true },
    ]);
  });

  test("displayed math may span the lines of a paragraph", () => {
    expect(math("So:\n\\[\n\\sum_{i=1}^n i\n\\]\ndone")).toEqual([{ value: "\n\\sum_{i=1}^n i\n", display: true }]);
  });

  test("an escaped backslash inside does not close it", () => {
    expect(math("\\[ a \\\\] b \\]")).toEqual([{ value: " a \\\\] b ", display: true }]);
  });

  test("dollar signs still work, and a single one stays a dollar sign", () => {
    expect(math("$$x^2$$ costs $5 or $6")).toEqual([{ value: "x^2", display: false }]);
  });

  test("unclosed or empty delimiters, and code, stay as they are", () => {
    expect(math("\\(open")).toEqual([]);
    expect(text("\\(open")).toBe("(open");
    expect(math("\\(\\)")).toEqual([]);
    expect(math("`\\(x\\)`\n\n```\n\\[x\\]\n```")).toEqual([]);
  });
});

describe("untrusted Markdown", () => {
  test("raw HTML shows as text, except line breaks", () => {
    const tree = parse('Wrap it in <div class="x">this</div>.\n\n| a |\n|---|\n| one<br>two |');
    expect(all(tree, "html")).toEqual([]);
    expect(text('Wrap it in <div class="x">this</div>.')).toBe('Wrap it in <div class="x">this</div>.');
    expect(all(tree, "break")).toHaveLength(1);
  });

  test("links to the web and to mail stay; others become their text", () => {
    const tree = parse(
      "[web](https://example.com) [mail](mailto:a@b.c) [file](src/app.ts#L3) [js](javascript:alert(1)) [ref][r]\n\n[r]: ./notes.md",
    );
    expect(all(tree, "link").map((link) => link.url)).toEqual(["https://example.com", "mailto:a@b.c"]);
    expect(all(tree, "linkReference")).toEqual([]);
    expect(text("[file](src/app.ts) and [ref][r]\n\n[r]: ./notes.md")).toBe("file and ref");
  });

  test("images load only from the web; others become their alt text", () => {
    const tree = parse("![chart](https://example.com/a.png) ![secret](/etc/passwd) ![](data:image/png;base64,AA==)");
    expect(all(tree, "image").map((image) => image.url)).toEqual(["https://example.com/a.png"]);
    expect(text("![secret](/etc/passwd)")).toBe("secret");
  });
});
