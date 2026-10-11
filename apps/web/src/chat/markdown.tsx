import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo } from "react";
import { Streamdown } from "streamdown";

const plugins = { cjk, code, math, mermaid };

/** Markdown of a message: code with highlighting, math, Mermaid diagrams, and CJK-aware emphasis. */
export const Markdown = memo(
  function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
    return (
      <Streamdown
        className="min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        plugins={plugins}
        isAnimating={streaming}
      >
        {text}
      </Streamdown>
    );
  },
  (previous, next) => previous.text === next.text && previous.streaming === next.streaming,
);
