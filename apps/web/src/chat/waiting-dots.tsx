/** Three dots bouncing in turn: the agent is at work but nothing on screen moves. As in pmgg. */
export function WaitingDots({ label = "Working" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex h-5 items-center gap-1.5 px-1">
      <span className="size-1.5 animate-typing-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
      <span className="size-1.5 animate-typing-bounce rounded-full bg-muted-foreground/60 [animation-delay:700ms]" />
      <span className="size-1.5 animate-typing-bounce rounded-full bg-muted-foreground/60 [animation-delay:1400ms]" />
    </div>
  );
}
