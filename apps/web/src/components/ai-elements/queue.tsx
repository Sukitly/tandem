import { CircleCheckIcon, CircleDotIcon, CircleIcon, ListChecksIcon, ListTodoIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace.tsx";

export interface QueueItem {
  id: string | number;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface QueueProps {
  items: QueueItem[];
  streaming?: boolean;
  defaultOpen?: boolean;
}

function QueueLine({ item, streaming }: { item: QueueItem; streaming?: boolean }) {
  const running = streaming && item.status === "in_progress";
  return (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        {item.status === "completed" ? (
          <CircleCheckIcon />
        ) : item.status === "in_progress" ? (
          <CircleDotIcon />
        ) : (
          <CircleIcon />
        )}
      </TraceIcon>
      <TraceTitle>{item.content}</TraceTitle>
    </TraceLine>
  );
}

/**
 * Queue displays the agent's queue of tasks or messages, split into what is left and what is done.
 * Follows the shadcn/ui AI Elements Queue pattern.
 */
export function Queue({ items, streaming = false, defaultOpen = true }: QueueProps) {
  const pending = items.filter((item) => item.status !== "completed");
  const completed = items.filter((item) => item.status === "completed");

  if (items.length === 0) return null;

  return (
    <Trace>
      {pending.length > 0 && (
        <TraceCollapsible defaultOpen={defaultOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <ListTodoIcon />
              </TraceIcon>
              <TraceTitle>{pending.length} to do</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace>
              {pending.map((item) => (
                <QueueLine key={item.id} item={item} streaming={streaming} />
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
      {completed.length > 0 && (
        <TraceCollapsible defaultOpen={defaultOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <ListChecksIcon />
              </TraceIcon>
              <TraceTitle>{completed.length} completed</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace>
              {completed.map((item) => (
                <QueueLine key={item.id} item={item} streaming={streaming} />
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  );
}
