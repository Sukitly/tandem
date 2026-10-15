import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { FileCodeIcon } from "lucide-react";
import { Children, type ComponentProps, createElement, isValidElement, memo, type ReactNode, useState } from "react";
import remarkBreaks from "remark-breaks";
import {
  type Components,
  defaultComponents,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  Streamdown,
  useIsCodeFenceIncomplete,
} from "streamdown";
import { CodeBlockWrapButton } from "@/components/ai-elements/index.ts";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block.tsx";
import { parseFileLink } from "@/files/file-link.ts";
import { FileLink } from "@/files/file-link-button.tsx";
import { HighlightedLine, useHighlighted } from "./highlight.tsx";
import { texDelimiters } from "./tex-delimiters.ts";
import { untrustedMarkdown } from "./untrusted-markdown.ts";

const plugins = { cjk, code, math, mermaid };
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

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sql: "SQL",
  rust: "Rust",
  rs: "Rust",
  go: "Go",
  cpp: "C++",
  c: "C",
  java: "Java",
  kotlin: "Kotlin",
  diff: "Diff",
  md: "Markdown",
  markdown: "Markdown",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  xml: "XML",
  graphql: "GraphQL",
};

export function formatCodeBlockTitle(filename?: string, language?: string): string {
  if (filename && filename.trim() !== "") {
    return filename;
  }
  if (!language || language.trim() === "" || language === "text") {
    return "Code";
  }
  const lower = language.toLowerCase();
  return LANGUAGE_LABELS[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function parseFencedInfo(languageRaw?: string): { language?: string; filename?: string } {
  let lang = languageRaw;
  let filename: string | undefined;

  if (lang?.includes(":")) {
    const [l, f] = lang.split(":", 2);
    lang = l;
    filename = f;
  }

  return { language: lang, filename };
}

function FencedCode({ code: text, language: rawLanguage }: { code: string; language: string | undefined }) {
  const [wrap, setWrap] = useState(false);
  const incomplete = useIsCodeFenceIncomplete();
  const { language, filename } = parseFencedInfo(rawLanguage);
  const cleanCode = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lang = language ?? "text";
  const highlightedTokens = useHighlighted(cleanCode, lang, incomplete);
  const isMultiLine = cleanCode.includes("\n");
  const title = formatCodeBlockTitle(filename, language);

  const lines = highlightedTokens ?? cleanCode.split("\n").map((line) => [{ content: line }]);

  return (
    <CodeBlock className="my-4">
      <CodeBlockHeader className="border-b border-border/50 py-1.5">
        <CodeBlockTitle>
          <FileCodeIcon className="size-3.5 text-muted-foreground" />
          {title}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockWrapButton
            wrap={wrap}
            onWrapChange={setWrap}
            className="[@media(hover:hover)]:opacity-0 group-hover/code-block:opacity-100 focus-visible:opacity-100 transition-opacity"
          />
          <CodeBlockCopyButton
            value={cleanCode}
            disabled={incomplete}
            aria-label="Copy code"
            className="[@media(hover:hover)]:opacity-0 group-hover/code-block:opacity-100 focus-visible:opacity-100 transition-opacity"
          />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers={isMultiLine} wrap={wrap} className="overflow-x-auto">
        {lines.map((lineTokens, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines in code block are positional
          <CodeBlockLine key={index}>
            <HighlightedLine tokens={lineTokens} />
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
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
