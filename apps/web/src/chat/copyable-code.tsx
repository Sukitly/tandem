import type { ReactNode } from "react";
import { CodeCopyButton } from "@/components/copy-text.tsx";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * A small box of code with a copy button in its corner, which copies `value` and not what is drawn (a prompt, say), and
 * shows when the box is pointed at or reached with the keyboard, and always on a touch screen. A copy that fails says
 * so: `CodeCopyButton` is used and not the generated one, which swallows the failure.
 */
export function CopyableCode({
  value,
  label,
  variant,
  className,
  children,
}: {
  value: string;
  /** Names the copy button, which is the only thing that tells two of them in a row apart. */
  label: string;
  variant?: "default" | "destructive";
  /** Classes of the scrolling code area, such as a `max-h-*`. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <CodeBlock size="sm" variant={variant}>
      <div className="absolute end-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover/code-block:opacity-100 group-has-[:focus-visible]/code-block:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
        <CodeCopyButton value={value} aria-label={label} />
      </div>
      <CodeBlockContent wrap className={cn("pe-9", className)}>
        {children}
      </CodeBlockContent>
    </CodeBlock>
  );
}
