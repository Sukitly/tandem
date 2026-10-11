import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Children, type ComponentProps, createElement, isValidElement, memo, type ReactNode } from "react";
import { type Components, defaultComponents, Streamdown, useIsCodeFenceIncomplete } from "streamdown";
import { CodeBlock } from "./code-block.tsx";

const plugins = { cjk, code, math, mermaid };

/**
 * Code blocks are Tandem's own (`CodeBlock`); inline code and Mermaid diagrams keep Streamdown's. Streamdown marks a
 * fenced block's `code` element with `data-block` and its language with a `language-*` class.
 */
const components: Components = {
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

/** Markdown of a message: code with highlighting, math, Mermaid diagrams, and CJK-aware emphasis. */
export const Markdown = memo(
  function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
    return (
      <Streamdown
        className="min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        plugins={plugins}
        components={components}
        isAnimating={streaming}
      >
        {text}
      </Streamdown>
    );
  },
  (previous, next) => previous.text === next.text && previous.streaming === next.streaming,
);
