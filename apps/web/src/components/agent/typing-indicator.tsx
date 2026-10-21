import { cn } from "cn";
import type { ComponentProps } from "react";

// Staggered by a third of the animation duration (2.1s) so the dots bounce in sequence.
const DOT_DELAY_CLASS_NAMES = ["[animation-delay:0ms]", "[animation-delay:700ms]", "[animation-delay:1400ms]"];

type TypingIndicatorProps = ComponentProps<"div"> & {
  /** Accessible label announced to screen readers. */
  label?: string;
};

/** Three bouncing dots that show the agent is working but nothing else is updating. */
function TypingIndicator({ label = "Thinking", className, ...props }: TypingIndicatorProps) {
  return (
    <div
      data-slot="typing-indicator"
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("gap-1.5 px-1 py-1 flex items-center", className)}
      {...props}
    >
      {DOT_DELAY_CLASS_NAMES.map((delayClassName) => (
        <span
          key={delayClassName}
          className={cn(
            "size-1.5 rounded-full bg-muted-foreground/60 animate-typing-bounce motion-reduce:animate-none",
            delayClassName,
          )}
        />
      ))}
    </div>
  );
}

export { TypingIndicator };
