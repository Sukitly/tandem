import { type ComponentProps, createContext, memo, useContext } from "react";
import type { Components, ExtraProps } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { Markdown as AgentMarkdown, MarkdownPre, readCodeFence } from "@/components/agent/markdown.tsx";
import { parseFileLink } from "@/files/file-link.ts";
import { FileLink } from "@/files/file-link-button.tsx";
import { cjkAutolink } from "./cjk-autolink.ts";
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import { texDelimiters } from "./tex-delimiters.ts";
import { keepAddress, untrustedMarkdown } from "./untrusted-markdown.ts";
import { useThrottledText } from "./use-throttled-text.ts";

/** Whether the text being drawn is still arriving, for a part inside it that must wait for the whole of its source. */
const StreamingContext = createContext(false);

// GFM runs before these, as agent-ui's `Markdown` has it. Math is dollar signs, with a single one left a dollar sign; Chinese, Japanese
// and Korean text gets emphasis and strikethrough next to its punctuation, and addresses end at it. A single newline is
// a line break, as a person writing in a message box expects.
const remarkPlugins: PluggableList = [
  [remarkMath, { singleDollarTextMath: false }],
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  cjkAutolink,
  remarkBreaks,
  texDelimiters,
  untrustedMarkdown,
];

// There is no rehype-sanitize: raw HTML is text by now (`untrustedMarkdown`, and there is no rehype-raw to parse it),
// and what could still do harm is an address, which `keepAddress` allows by name. Sanitizing would also empty the
// address of a link to a file with no folder, `app.ts:12`, taking its `app.ts` for a scheme, as react-markdown does.
const rehypePlugins: PluggableList = [[rehypeKatex, { errorColor: "var(--color-muted-foreground)" }]];

/** A link to a file opens it in the files panel; one to the web opens in a new tab, so the page stays where it is. */
function Link({ node, href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  const web = href !== undefined && /^https?:\/\//i.test(href);
  const file = href === undefined || web || /^mailto:/i.test(href) ? undefined : parseFileLink(href);
  if (file !== undefined) return <FileLink target={file}>{children}</FileLink>;
  return (
    <a href={href} {...(web ? { target: "_blank", rel: "noreferrer noopener" } : {})} {...props}>
      {children}
    </a>
  );
}

/** A fence is the code panel, except Mermaid, which is a diagram once the text is whole. */
function Pre({ node, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const streaming = useContext(StreamingContext);
  const fence = readCodeFence(node);
  const panel = <MarkdownPre node={node} {...props} />;
  return fence?.language === "mermaid" ? (
    <MermaidDiagram code={fence.code} streaming={streaming} fallback={panel} />
  ) : (
    panel
  );
}

// Declared once, so a streaming update does not mount what they draw again.
const components: Components = { a: Link, pre: Pre };

/**
 * Markdown of a message: code with highlighting, math (`$$…$$`, `\(…\)`, `\[…\]`), Mermaid diagrams, and CJK-aware
 * emphasis. Untrusted: see `untrustedMarkdown`.
 */
export const Markdown = memo(
  function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
    const drawn = useThrottledText(text, streaming);
    return (
      <StreamingContext value={streaming}>
        <AgentMarkdown
          className="min-w-0"
          streaming={streaming}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={keepAddress}
        >
          {drawn}
        </AgentMarkdown>
      </StreamingContext>
    );
  },
  (previous, next) => previous.text === next.text && previous.streaming === next.streaming,
);
