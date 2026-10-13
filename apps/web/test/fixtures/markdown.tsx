import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../src/chat/markdown.tsx";
import { Button } from "../../src/components/ui/button.tsx";
import "../../src/index.css";

const sample = [
  "# Chat Markdown typography",
  "Body text, **emphasis**, and `inline_code` should remain easy to read together.",
  "## Long identifiers and loose lists",
  "1. **Port `apps/server/src/services/prompt-templates.ts`, rather than importing it.** " +
    "The package `@earendil-works/pi-coding-agent@1.1.0` exports `loadPromptTemplates` and `expandPromptTemplate`. " +
    "Keep long explanations aligned with their list item's text, not its number.\n\n" +
    "   A second paragraph must stay separate.\n\n" +
    "   - Use the project's execution environment.\n" +
    "   - Validate paths before reading files.",
  "2. Long paths must wrap, including when they have no spaces: `apps/server/src/" +
    "long-directory/".repeat(8) +
    "prompt-templates.ts` and `" +
    "identifier".repeat(20) +
    "`.",
  "### Fenced code stays independent",
  '```ts\nconst template = await loadPromptTemplates(project);\nconst longLine = "' +
    "long code stays horizontally scrollable; ".repeat(4) +
    '";\n```',
  "> A quoted paragraph.\n>\n> Another quoted paragraph.",
  "- [x] Preserve Markdown safety checks\n- [ ] Check narrow viewports",
  "## Plugin UI keeps its paragraph spacing",
  "[Open the link confirmation](https://example.com). Its warning paragraph must not receive chat paragraph spacing.",
  "The deliberately invalid diagram below exercises Streamdown's real error paragraph:",
  "```mermaid\nnot-a-valid-diagram\n```",
].join("\n\n");

function Fixture() {
  const [dark, setDark] = useState(false);
  const [visible, setVisible] = useState(sample.length);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!streaming) return;
    if (visible === sample.length) {
      setStreaming(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible((current) => Math.min(current + 60, sample.length)), 80);
    return () => window.clearTimeout(timer);
  }, [streaming, visible]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setDark((current) => !current)}>
          {dark ? "Use light theme" : "Use dark theme"}
        </Button>
        <Button
          variant="outline"
          disabled={streaming}
          onClick={() => {
            setVisible(0);
            setStreaming(true);
          }}
        >
          Replay streaming
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {streaming ? "Streaming" : "Complete"}
        </span>
      </div>
      <Markdown text={sample.slice(0, visible)} streaming={streaming} />
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("The fixture root is missing");
createRoot(root).render(<Fixture />);
