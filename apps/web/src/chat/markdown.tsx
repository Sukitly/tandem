import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Children, type ComponentProps, createElement, isValidElement, memo, type ReactNode } from "react";
import {
  type Components,
  defaultComponents,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  useIsCodeFenceIncomplete,
} from "streamdown";
import { parseFileLink } from "@/files/file-link.ts";
import { FileLink } from "@/files/file-link-button.tsx";
import { CodeBlock } from "./code-block.tsx";
import { texDelimiters } from "./tex-delimiters.ts";
import { untrustedMarkdown } from "./untrusted-markdown.ts";

const plugins = { cjk, code, math, mermaid };
const remarkPlugins = [...Object.values(defaultRemarkPlugins), texDelimiters, untrustedMarkdown];
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

function FencedCode({ code: text, language }: { code: string; language: string | undefined }) {
  const incomplete = useIsCodeFenceIncomplete();
  return <CodeBlock code={text} language={language} streaming={incomplete} className="my-3" />;
}

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
        className="min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        plugins={plugins}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        isAnimating={streaming}
      >
        {text}
      </Streamdown>
    );
  },
  (previous, next) => previous.text === next.text && previous.streaming === next.streaming,
);
