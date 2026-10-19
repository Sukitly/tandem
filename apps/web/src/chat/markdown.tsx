import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { Children, type ComponentProps, createElement, isValidElement, memo, type ReactNode } from "react";
import remarkBreaks from "remark-breaks";
import { type Components, defaultComponents, defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";
import { parseFileLink } from "@/files/file-link.ts";
import { FileLink } from "@/files/file-link-button.tsx";
import { FencedCode } from "./fenced-code.tsx";
import { lazyMermaid } from "./lazy-mermaid.ts";
import { texDelimiters } from "./tex-delimiters.ts";
import { untrustedMarkdown } from "./untrusted-markdown.ts";

export { formatCodeBlockTitle, parseFencedInfo } from "./fenced-code.tsx";

const plugins = { cjk, code, math, mermaid: lazyMermaid };
// A single newline is a line break, as a person writing in a message box expects.
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks, texDelimiters, untrustedMarkdown];
// Raw HTML is text by now, and links and images are checked by `untrustedMarkdown`; sanitizing stays.
const sanitize = defaultRehypePlugins.sanitize;
if (sanitize === undefined) throw new Error("Streamdown's sanitize plugin is missing");
const rehypePlugins = [sanitize];

/**
 * Code blocks are Tandem's own (`CodeBlock`), and so are links to files (`FileLink`); inline code and Mermaid diagrams
 * keep Streamdown's. Streamdown marks a fenced block's `code` element with `data-block` and its language with a
 * `language-*` class.
 */
const components: Components = {
  // Only Markdown paragraphs receive chat spacing; plugin UI paragraphs keep their own styles.
  // Delegate to Streamdown so images and fenced blocks still omit their paragraph wrapper.
  p: (props: object) =>
    createElement(defaultComponents.p, { ...props, "data-chat-markdown": "paragraph" } as ComponentProps<"p">),
  ol: (props: object) =>
    createElement(defaultComponents.ol, {
      ...props,
      className: (props as { className?: string }).className?.replace(/\blist-inside\b/g, "list-outside"),
    } as ComponentProps<"ol">),
  ul: (props: object) =>
    createElement(defaultComponents.ul, {
      ...props,
      className: (props as { className?: string }).className?.replace(/\blist-inside\b/g, "list-outside"),
    } as ComponentProps<"ul">),
  // Links to files open them in the files panel; links to the web keep Streamdown's, which asks before leaving.
  a: (props: object) => {
    const { href, children } = props as ComponentProps<"a">;
    const target = href === undefined || /^(https?|mailto):/i.test(href) ? undefined : parseFileLink(href);
    if (target === undefined) return createElement(defaultComponents.a, props as ComponentProps<"a">);
    return <FileLink target={target}>{children}</FileLink>;
  },
  // `object`: Streamdown types a component both as its element's props and as any record.
  code: (props: object) => {
    const { className, children } = props as ComponentProps<"code">;
    const language = /language-(\S+)/.exec(className ?? "")?.[1];
    if (!("data-block" in props) || language === "mermaid") {
      return createElement(defaultComponents.code, props as ComponentProps<"code">);
    }
    return <FencedCode code={textOf(children).replace(/\n$/, "")} language={language} />;
  },
};

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textOf(child.props.children)
          : "",
    )
    .join("");
}

/**
 * Markdown of a message: code with highlighting, math (`$$…$$`, `\(…\)`, `\[…\]`), Mermaid diagrams, and CJK-aware
 * emphasis. Untrusted: see `untrustedMarkdown`.
 */
export const Markdown = memo(
  function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
    return (
      <Streamdown
        className="chat-markdown min-w-0"
        plugins={plugins}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        tableMaxHeight="none"
        isAnimating={streaming}
      >
        {text}
      </Streamdown>
    );
  },
  (previous, next) => previous.text === next.text && previous.streaming === next.streaming,
);
