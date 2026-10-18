import { FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { useIsCodeFenceIncomplete } from "streamdown";
import { CodeBlockWrapButton } from "@/components/ai-elements/index.ts";
import { CodeCopyButton } from "@/components/copy-text.tsx";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block.tsx";
import { HighlightedLine, useHighlighted } from "./highlight.tsx";

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

export function FencedCode({ code: text, language: rawLanguage }: { code: string; language: string | undefined }) {
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
          <CodeCopyButton
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
