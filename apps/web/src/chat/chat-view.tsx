import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation as ConversationService } from "@tandem/contracts";
import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useConversation } from "@/rpc/use-conversation.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChatComposer } from "./chat-composer.tsx";
import { type TranscriptItem, toTranscript } from "./transcript.ts";

/** One conversation: its transcript and the message box. */
export function ChatView({ conversationId }: { conversationId: number }) {
  const conversation = useConversation(conversationId);
  if (conversation === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Opening the conversation</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  // Keyed, so a reopened instance starts from its own state.
  return <OpenChat key={conversationId} conversation={conversation} />;
}

function OpenChat({ conversation }: { conversation: ConversationService }) {
  const view = useReplicatedState(conversation.view);
  const transcript = useMemo(() => (view === undefined ? undefined : toTranscript(view)), [view]);
  if (transcript === undefined) return null;
  const empty = transcript.items.length === 0;

  const composer = (
    <ChatComposer
      busy={transcript.busy}
      queued={transcript.queued}
      autoFocus
      onSend={(text, whenBusy) => conversation.submit({ text, whenBusy }, BACKGROUND_CONTEXT)}
      onStop={() => {
        conversation.abort(BACKGROUND_CONTEXT).catch((error: unknown) => console.error(error));
      }}
    />
  );

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden" aria-label="Conversation">
      {!empty && (
        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6">
            {transcript.items.map((item) => (
              <TranscriptMessage key={item.key} item={item} />
            ))}
          </ConversationContent>
          <ConversationScrollButton aria-label="Scroll to the latest message" className="rounded-none" />
        </Conversation>
      )}
      <div className={cn("mx-auto w-full max-w-3xl px-4", empty ? "my-auto py-6" : "pt-3 pb-6")}>
        {empty && <ConversationEmptyState className="mb-6 h-auto p-0" title="What are we working on?" description="" />}
        {composer}
      </div>
    </section>
  );
}

function TranscriptMessage({ item }: { item: TranscriptItem }) {
  if (item.kind === "user") {
    return (
      <Message from="user">
        <MessageContent>
          <ChatMarkdown text={item.text} />
        </MessageContent>
      </Message>
    );
  }
  if (item.kind === "streaming") {
    return (
      <Message from="assistant">
        <MessageContent>
          {item.text === "" ? <Shimmer duration={1}>Thinking…</Shimmer> : <ChatMarkdown text={item.text} streaming />}
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message from="assistant">
      {item.text !== "" && (
        <MessageContent>
          <ChatMarkdown text={item.text} />
        </MessageContent>
      )}
      {item.ending === "interrupted" && <Badge variant="outline">Interrupted</Badge>}
      {item.ending === "failed" && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>The answer failed</AlertTitle>
          {item.error !== undefined && <AlertDescription>{item.error}</AlertDescription>}
        </Alert>
      )}
      {item.ending === "complete" && item.text !== "" && (
        <MessageActions>
          <CopyAction text={item.text} />
        </MessageActions>
      )}
    </Message>
  );
}

function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <MessageResponse isAnimating={streaming}>{text}</MessageResponse>;
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </MessageAction>
  );
}
