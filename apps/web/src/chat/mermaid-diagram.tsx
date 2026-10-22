import { type ReactNode, useEffect, useState } from "react";
import { errorMessage } from "@/lib/errors.ts";

/** Loads once, on the first call. A load that failed is asked for again by the next call, not remembered as failed. */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
}

/**
 * Mermaid, which is several megabytes and drawn by few conversations, so its code is loaded when a diagram is first
 * drawn, not when the page starts.
 */
const loadMermaid = lazy(async () => {
  const { default: mermaid } = await import("mermaid");
  // `strict` has mermaid sanitize what it draws, and keeps a diagram from running script or opening a link.
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    fontFamily: "monospace",
    suppressErrorRendering: true,
  });
  return mermaid;
});

let drawn = 0;

async function draw(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  // The id is a selector for mermaid, so it cannot be what `useId` gives, which has colons.
  return (await mermaid.render(`mermaid-diagram-${++drawn}`, source)).svg;
}

type Outcome = { source: string; svg: string } | { source: string; error: string };

/**
 * A Mermaid diagram. While the text is still arriving, and until the diagram is drawn, it is `fallback`, the source as
 * a code block, so a half-written diagram is never drawn and never reports an error. A diagram that cannot be drawn
 * stays the source, with what Mermaid said under it.
 */
export function MermaidDiagram({
  code,
  streaming,
  fallback,
}: {
  code: string;
  streaming: boolean;
  fallback: ReactNode;
}) {
  const [outcome, setOutcome] = useState<Outcome>();
  useEffect(() => {
    if (streaming) return;
    let current = true;
    draw(code).then(
      (svg) => current && setOutcome({ source: code, svg }),
      (error: unknown) => current && setOutcome({ source: code, error: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [code, streaming]);

  const shown = streaming || outcome?.source !== code ? undefined : outcome;
  if (shown === undefined) return fallback;
  if ("error" in shown) {
    return (
      <>
        {fallback}
        <p role="alert" className="not-typeset mt-2 text-destructive text-sm">
          Could not draw the diagram: {shown.error}
        </p>
      </>
    );
  }
  return (
    <div
      className="not-typeset mt-(--typeset-flow) overflow-x-auto rounded-lg bg-muted p-4 ring-1 ring-foreground/5 dark:ring-foreground/10 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid sanitizes its output in strict mode
      dangerouslySetInnerHTML={{ __html: shown.svg }}
    />
  );
}
