import { cn } from "cn";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MessageFooter } from "@/components/ui/message";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type MessageActionsProps = ComponentProps<typeof MessageFooter> & {
  /**
   * Keep the row showing, such as for the latest reply. Without it the row is
   * out of sight until the message is pointed at or a button in it is reached
   * with the keyboard, on a screen with a pointer. A click that leaves a button
   * focused does not keep it showing. A touch screen has no pointer to hover with, so
   * the row always shows there.
   */
  persist?: boolean;
};

/**
 * A row of small buttons under a message, such as copy and regenerate. Put it
 * last among the turn's content: inside `MessageListItem` under the reply, or
 * as `UserMessage`'s `actions`. Render it once the message is finished, not
 * while it streams.
 *
 * It takes its space whether or not it shows, so a message does not move when
 * the row appears.
 */
function MessageActions({ persist = false, className, ...props }: MessageActionsProps) {
  return (
    <MessageFooter
      // Without `persist` the row is hidden until the message is hovered or
      // focused, where there is a hover. The style says how, behind this.
      data-hover-reveal={!persist || undefined}
      className={cn(
        "gap-0.5 px-0 group-data-[align=start]/message:-ml-1.5 data-[hover-reveal=true]:group-hover/message:opacity-100 data-[hover-reveal=true]:has-focus-visible:opacity-100 data-[hover-reveal=true]:[@media(hover:hover)]:opacity-0 transition-opacity motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

type MessageActionProps = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  /** What the button does. Its tooltip, and what screen readers hear. */
  label: string;
  /** For a button that is on or off, such as a rating. */
  pressed?: boolean;
};

/**
 * One icon button in `MessageActions`, grey until it is pointed at, with its
 * label as a tooltip. Pass the icon as the child.
 */
function MessageAction({ label, pressed, className, children, ...props }: MessageActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={pressed}
            className={cn("text-muted-foreground hover:text-foreground aria-pressed:text-foreground", className)}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type MessageCopyActionProps = Omit<MessageActionProps, "label" | "pressed" | "onClick" | "children"> & {
  /**
   * What to copy. A function is called when the button is clicked, so a long
   * text is not built for every message that is never copied.
   */
  text: string | (() => string | Promise<string>);
  label?: string;
  /** Shown for two seconds after the text is copied. */
  copiedLabel?: string;
  /** Shown for two seconds when it could not be copied. */
  failedLabel?: string;
};

/**
 * A copy button. It puts the text on the clipboard and shows a check for two
 * seconds. When that does not work, for instance on a page that is not secure,
 * it shows a warning instead. Either way the tooltip says what happened, and
 * screen readers are told, since the button alone would not announce that its
 * label changed.
 */
function MessageCopyAction({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Could not copy",
  ...props
}: MessageCopyActionProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    let next: "copied" | "failed" = "copied";

    try {
      await navigator.clipboard.writeText(typeof text === "function" ? await text() : text);
    } catch {
      next = "failed";
    }

    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  }, [text]);

  const current = status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label;

  return (
    <>
      <MessageAction label={current} onClick={copy} {...props}>
        {status === "copied" ? (
          <CheckIcon />
        ) : status === "failed" ? (
          <TriangleAlertIcon className="text-destructive" />
        ) : (
          <CopyIcon />
        )}
      </MessageAction>
      {/* Outside the button, whose children screen readers do not read out as
          they change. An `output` is a live region. */}
      <output className="sr-only">{status === "idle" ? "" : current}</output>
    </>
  );
}

export { MessageAction, MessageActions, MessageCopyAction };
