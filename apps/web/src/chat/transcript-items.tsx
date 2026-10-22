import { ImageIcon } from "lucide-react";
import { MessageActions, MessageCopyAction } from "@/components/agent/message-actions.tsx";
import { MessageListItem } from "@/components/agent/message-list.tsx";
import { UserMessage, type UserMessageAttachment } from "@/components/agent/user-message.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker.tsx";
import { MessageScrollerItem } from "@/components/ui/message-scroller.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Trace } from "@/components/ui/trace.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { ChatError } from "./chat-error.tsx";
import { Markdown } from "./markdown.tsx";
import { ThinkingStep, ToolStep } from "./tool-steps.tsx";
import type { AssistantPart, TranscriptItem } from "./transcript.ts";

export { ChatError } from "./chat-error.tsx";
export { toolDescription } from "./tool-description.ts";

/**
 * One turn of the transcript: the scroller row, with whatever the item is inside it. It must be inside a
 * `MessageList`. `joinsPrevious` closes up the space above a reply that follows another reply, since back-to-back
 * replies are one agent turn.
 */
export function TranscriptEntry({ item, joinsPrevious = false }: { item: TranscriptItem; joinsPrevious?: boolean }) {
  switch (item.kind) {
    case "user":
      return <UserTurn item={item} />;
    case "assistant":
      return <AssistantMessage item={item} joinsPrevious={joinsPrevious} />;
    // A marker takes the whole width of the column, so it is a row of its own and not inside a message, whose content
    // is narrower than the column.
    case "compaction":
      return (
        <MessageScrollerItem messageId={item.key}>
          <Marker variant="separator">
            <MarkerContent>Older messages were summarized</MarkerContent>
          </Marker>
        </MessageScrollerItem>
      );
    case "compacting":
      return (
        <MessageScrollerItem messageId={item.key}>
          <Marker role="status">
            <MarkerIcon>
              <Spinner />
            </MarkerIcon>
            <MarkerContent>Compacting the conversation</MarkerContent>
          </Marker>
        </MessageScrollerItem>
      );
  }
}

/**
 * What the person typed, as typed, and the images sent with it as tiles. An image with no `ref` is not stored yet:
 * it has no address, so its tile says it is waiting. Addresses use the HttpOnly session cookie of the page, never a
 * credential or a token in the URL.
 */
function UserTurn({ item }: { item: Extract<TranscriptItem, { kind: "user" }> }) {
  const { imageUrl } = useConnected();
  const attachments = item.images.map(
    (image, index): UserMessageAttachment =>
      image.ref === undefined
        ? { name: `Image ${index + 1}`, icon: <ImageIcon />, description: "Not sent yet" }
        : { name: `Image ${index + 1}`, src: imageUrl(image.ref) },
  );
  return (
    <UserMessage
      id={item.key}
      // The transcript follows the live edge, and sending already scrolls to the end. The question is not
      // pinned near the top while the reply streams in below it.
      anchor={false}
      pictures="original"
      attachments={attachments}
      attachmentsLabel="Images"
      actions={
        item.text === "" ? undefined : (
          <MessageActions>
            <MessageCopyAction text={item.text} />
          </MessageActions>
        )
      }
    >
      {item.text}
    </UserMessage>
  );
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

function AssistantMessage({
  item,
  joinsPrevious,
}: {
  item: Extract<TranscriptItem, { kind: "assistant" }>;
  joinsPrevious: boolean;
}) {
  const streaming = item.ending === "streaming";
  const text = item.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n\n");
  const answer = !item.parts.some((part) => part.kind === "tool");
  const segments = segmentAssistantParts(item.parts);

  return (
    <MessageListItem
      id={item.key}
      // Each model call is its own assistant item. Back-to-back ones are one agent turn, so they use the
      // 8px spacing of steps inside a message (gap-2) instead of the 24px gap (gap-6) between messages.
      className={joinsPrevious ? "-mt-4" : undefined}
    >
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
        <MessageActions>
          <MessageCopyAction text={text} />
        </MessageActions>
      )}
    </MessageListItem>
  );
}
