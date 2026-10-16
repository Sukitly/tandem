import type { ComponentProps } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group.tsx";
import { cn } from "@/lib/utils.ts";

export function PromptInput({ className, ...props }: ComponentProps<typeof InputGroup>) {
  return (
    <InputGroup
      className={cn(
        "bg-background shadow-xs transition-shadow focus-within:ring-1 focus-within:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputTextarea({ className, ...props }: ComponentProps<typeof InputGroupTextarea>) {
  return (
    <InputGroupTextarea
      className={cn(
        "min-h-14 p-3 leading-relaxed outline-none border-none shadow-none focus-visible:ring-0",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputActions({ className, ...props }: ComponentProps<typeof InputGroupAddon>) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn("flex items-center gap-1.5 p-2 pt-0 min-w-0", className)}
      {...props}
    />
  );
}

export function PromptInputAttachments({ className, ...props }: ComponentProps<typeof InputGroupAddon>) {
  return <InputGroupAddon align="block-start" className={cn("flex-wrap gap-2 p-2 pb-0", className)} {...props} />;
}

export function PromptInputActionButton({ className, ...props }: ComponentProps<typeof InputGroupButton>) {
  return (
    <InputGroupButton size="icon-sm" variant="outline" className={cn("rounded-full shrink-0", className)} {...props} />
  );
}

export function PromptInputSubmitButton({ className, ...props }: ComponentProps<typeof InputGroupButton>) {
  return (
    <InputGroupButton size="icon-sm" variant="default" className={cn("rounded-full shrink-0", className)} {...props} />
  );
}
