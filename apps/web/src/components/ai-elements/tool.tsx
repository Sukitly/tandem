import { WrenchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";

export interface ToolProps {
  title: ReactNode;
  icon?: ReactNode;
  status?: "pending" | "running" | "done" | "error" | "failed" | "cancelled";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * Tool displays a generic tool execution step in a Trace list.
 * Follows the shadcn/ui AI Elements Tool pattern without coupling to specific domain tools.
 */
export function Tool({
  title,
  icon = <WrenchIcon />,
  status,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen,
  children,
}: ToolProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? status === "running");
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  const running = status === "running";
  const failed = status === "error" || status === "failed";
  const traceStatus: "running" | "error" | "pending" | undefined = running
    ? "running"
    : failed
      ? "error"
      : status === "pending"
        ? "pending"
        : undefined;

  const line = (
    <TraceLine status={traceStatus}>
      <TraceIcon>{icon}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
    </TraceLine>
  );

  const hasDetail = children !== undefined && children !== null && children !== false;
  if (!hasDetail) {
    return line;
  }

  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
