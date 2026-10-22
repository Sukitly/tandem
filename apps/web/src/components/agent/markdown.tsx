import { cn } from "cn";
import { type ComponentProps, useMemo } from "react";
import ReactMarkdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";

import { CodePanel } from "@/components/agent/code-panel";

type MarkdownProps = Omit<ComponentProps<"div">, "children"> &
  Pick<Options, "components" | "remarkPlugins" | "rehypePlugins" | "urlTransform"> & {
    /** Markdown source. Re-rendering with a longer string streams without remounting. */
    children: string;
    /**
     * Set while the text is still arriving. Syntax that is not closed yet, such as
     * `**bold` or an inline `code` span, then renders as formatting instead of
     * flashing as raw characters until the closing mark shows up. Leave it off
     * for finished text, so a stray `*` in a settled message is never rewritten.
     */
    streaming?: boolean;
  };

type CodeFence = {
  /**
   * What follows the backticks, up to the first space or comma, as it was
   * written: `ts`, `mermaid`, or `ts:foo.ts` when the author put a file name
   * after the language. Empty when the fence has none.
   */
  language: string;
  /** The source, without the line break that ends it. */
  code: string;
};

/**
 * Reads a fenced code block from the `node` that react-markdown gives a `pre`
 * component, or returns `undefined` when the `pre` is not a fence. Fenced code
 * arrives as `<pre><code>`, so the language and the source are read from the
 * hast node instead of from the rendered children.
 *
 * It is what `Markdown` uses for its own code panel, and what a `pre` of your
 * own needs to draw some fences differently, such as a diagram or a header with
 * a file name. Return `MarkdownPre` for the others.
 */
function readCodeFence(node: ExtraProps["node"]): CodeFence | undefined {
  const element = node?.children[0];

  if (element?.type !== "element" || element.tagName !== "code") {
    return undefined;
  }

  const language = /language-([^\s,]+)/.exec(String(element.properties.className ?? ""))?.[1] ?? "";
  const code = element.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "");

  return { language, code };
}

/**
 * The code panel `Markdown` draws for a fence, with the fill and the spacing it
 * has among the text. A `pre` of your own returns it for the fences it does not
 * handle, passing on its props (it needs `node`), so those look as they did
 * before. A `CodePanel` of your own does not have that fill or spacing.
 *
 * A file name written after the language, as in `ts:app.ts`, is the title of the
 * panel, and the code is highlighted in the language before it.
 */
function MarkdownPre({ node, children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const fence = readCodeFence(node);

  if (!fence) {
    return <pre {...props}>{children}</pre>;
  }

  // Only the first colon splits, so a file name may have one of its own.
  const colon = fence.language.indexOf(":");
  const language = colon === -1 ? fence.language : fence.language.slice(0, colon);
  const file = colon === -1 ? "" : fence.language.slice(colon + 1);

  return (
    <CodePanel
      code={fence.code}
      language={language}
      // Without a file name the panel is titled by its language.
      title={file || undefined}
      // The default variant is a bordered box with no fill in light mode, which
      // reads as an empty outline next to prose. The ai-elements message recipe
      // swaps that for a filled surface and a hairline ring, so match it.
      className="mt-(--typeset-flow) border-0 bg-muted ring-1 ring-foreground/5 dark:ring-foreground/10 not-typeset"
    />
  );
}

/**
 * A half-written image has no address yet. Rendering it with an empty `src`
 * makes the browser request the page itself, so render nothing until it is
 * complete.
 */
function MarkdownImage({ node, src, alt, ...props }: ComponentProps<"img"> & ExtraProps) {
  if (!src) {
    return null;
  }

  return <img src={src} alt={alt} {...props} />;
}

// Declared once so a streaming re-render keeps the same component identity.
const DEFAULT_COMPONENTS: Components = { pre: MarkdownPre, img: MarkdownImage };

// `text-only` shows an unfinished link as plain text. The default points it at
// a placeholder address, which would render as a link to the current page.
const REMEND_OPTIONS = { linkMode: "text-only" } as const;

/**
 * Renders assistant markdown, including code blocks highlighted with the same
 * shiki pipeline as the shadcn/ui code block. Typography comes from the
 * `typeset` styles shipped with this component.
 *
 * `components`, `remarkPlugins` and `rehypePlugins` go to react-markdown. Ours
 * come first: `remark-gfm` runs before your remark plugins, and your
 * `components` replace ours for the same element, so `pre` replaces the code
 * panel, and for every fence, not only the ones you handle: read the language
 * and the source with `readCodeFence`, and return `MarkdownPre` for the rest.
 * `img` replaces the guard for an image that has no address yet. A component
 * declared inside the component that renders this is a new one on every render,
 * so what it draws is mounted again while a reply streams. Declare the
 * components, and the plugin lists, outside it.
 *
 * `urlTransform` is react-markdown's, for the address of every link and image.
 * Without it an address that is not `http`, `https`, `irc`, `ircs`, `mailto`,
 * `xmpp` or relative is emptied, and one that has a colon before any slash,
 * such as the `app.ts:12` of a link to a line of a file, counts as having a
 * scheme and is emptied too. Pass your own to keep such addresses, and then
 * decide yourself which ones are safe: it is what stands between the reader and
 * a `javascript:` link, and the address of an image is passed through it as well.
 */
function Markdown({
  children,
  streaming = false,
  components,
  remarkPlugins,
  rehypePlugins,
  urlTransform,
  className,
  ...props
}: MarkdownProps) {
  const source = useMemo(() => (streaming ? remend(children, REMEND_OPTIONS) : children), [children, streaming]);
  const allComponents = useMemo(
    () => (components ? { ...DEFAULT_COMPONENTS, ...components } : DEFAULT_COMPONENTS),
    [components],
  );
  const allRemarkPlugins = useMemo(
    () => (remarkPlugins ? [remarkGfm, ...remarkPlugins] : [remarkGfm]),
    [remarkPlugins],
  );

  return (
    <div
      data-slot="markdown"
      // The style makes the text colour inherit, over the one typeset sets on
      // `.typeset`, so markdown follows the context it sits in. That keeps it
      // at full contrast in an assistant reply and muted inside a reasoning
      // panel.
      className={cn("text-inherit typeset", className)}
      {...props}
    >
      <ReactMarkdown
        components={allComponents}
        remarkPlugins={allRemarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export type { CodeFence };
export { Markdown, MarkdownPre, readCodeFence };
