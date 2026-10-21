import { Badge } from "@/components/ui/badge.tsx";
import { Bubble, BubbleContent } from "@/components/ui/bubble.tsx";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker.tsx";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Trace } from "@/components/ui/trace.tsx";
import { ChatError, CopyAction } from "./chat-error.tsx";
import { Markdown } from "./markdown.tsx";
import { ThinkingStep, ToolStep } from "./tool-steps.tsx";
import type { AssistantPart, TranscriptItem } from "./transcript.ts";
import { TranscriptImages } from "./transcript-images.tsx";

export { ChatError } from "./chat-error.tsx";
export { toolDescription } from "./tool-description.ts";

export function TranscriptEntry({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Message align="end">
          <MessageContent>
            <TranscriptImages images={item.images} className="max-w-[85%] self-end justify-end" />
            {item.text !== "" && (
              <Bubble align="end" variant="muted">
                <BubbleContent>
                  <Markdown text={item.text} />
                </BubbleContent>
              </Bubble>
            )}
            {item.text !== "" && (
              <MessageFooter className="px-0">
                <CopyAction text={item.text} />
              </MessageFooter>
            )}
          </MessageContent>
        </Message>
      );
    case "assistant":
      return <AssistantMessage item={item} />;
    case "compaction":
      return (
        <Marker variant="separator">
          <MarkerContent>Older messages were summarized</MarkerContent>
        </Marker>
      );
    case "compacting":
      return (
        <Marker role="status">
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent>Compacting the conversation</MarkerContent>
        </Marker>
      );
  }
}

type StepPart = Extract<AssistantPart, { kind: "thinking" | "tool" }>;

type AssistantSegment = { kind: "steps"; key: string; steps: StepPart[] } | { kind: "text"; key: string; text: string };

function segmentAssistantParts(parts: readonly AssistantPart[]): AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  let currentSteps: StepPart[] = [];
  let stepIndex = 0;
  let textIndex = 0;

  for (const part of parts) {
    if (part.kind === "text") {
      if (currentSteps.length > 0) {
        segments.push({ kind: "steps", key: `steps-${stepIndex++}`, steps: currentSteps });
        currentSteps = [];
      }
      segments.push({ kind: "text", key: `text-${textIndex++}`, text: part.text });
    } else {
      currentSteps.push(part);
    }
  }

  if (currentSteps.length > 0) {
    segments.push({ kind: "steps", key: `steps-${stepIndex++}`, steps: currentSteps });
  }

  return segments;
}

function AssistantMessage({ item }: { item: Extract<TranscriptItem, { kind: "assistant" }> }) {
  const streaming = item.ending === "streaming";
  const text = item.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n\n");
  const answer = !item.parts.some((part) => part.kind === "tool");
  const segments = segmentAssistantParts(item.parts);

  return (
    <Message align="start">
      <MessageContent className="gap-3">
        {segments.map((segment, segIdx) => {
          const isLastSegment = segIdx === segments.length - 1;
          if (segment.kind === "steps") {
            return (
              <Trace key={segment.key}>
                {segment.steps.map((step, stepIdx) => {
                  const isLastStep = isLastSegment && stepIdx === segment.steps.length - 1;
                  if (step.kind === "thinking") {
                    return (
                      <ThinkingStep
                        // biome-ignore lint/suspicious/noArrayIndexKey: thinking step sequence is stable
                        key={stepIdx}
                        step={step}
                        streaming={streaming && isLastStep}
                      />
                    );
                  }
                  return <ToolStep key={step.callId} step={step} />;
                })}
              </Trace>
            );
          }
          return <Markdown key={segment.key} text={segment.text} streaming={streaming && isLastSegment} />;
        })}
        {item.ending === "interrupted" && (
          <Badge variant="outline" className="self-start">
            Interrupted
          </Badge>
        )}
        {item.ending === "failed" && (
          <ChatError error={item.error} attempts={item.attempts} historical={item.continued} />
        )}
        {item.ending === "complete" && answer && text !== "" && (
          <MessageFooter className="px-0">
            <CopyAction text={text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
