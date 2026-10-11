import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationNotice } from "@tandem/contracts";
import { AlertCircleIcon, ArrowDownIcon, EllipsisIcon, FoldVerticalIcon, InfoIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useConnected } from "@/rpc/connection.tsx";
import { useConversation } from "@/rpc/use-conversation.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChatComposer } from "./chat-composer.tsx";
import { type AgentChoice, StatusBar } from "./status-bar.tsx";
import { toTranscript } from "./transcript.ts";
import { TranscriptEntry } from "./transcript-items.tsx";

/** One conversation: its header, transcript, and the message box. */
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
  return <OpenChat key={conversationId} conversationId={conversationId} conversation={conversation} />;
}

function OpenChat({ conversationId, conversation }: { conversationId: number; conversation: Conversation }) {
  const view = useReplicatedState(conversation.view);
  const notices = useReplicatedState(conversation.notices)?.notices ?? [];
  const [failure, setFailure] = useState<string | null>(null);
  const transcript = useMemo(() => (view === undefined ? undefined : toTranscript(view)), [view]);
  if (view === undefined || transcript === undefined) return null;
  const empty = transcript.items.length === 0;
  const agent = view.docs["pi.agent"] as AgentChoice | undefined;

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" aria-label="Conversation">
      <ChatHeader
        conversationId={conversationId}
        onCompact={() => {
          setFailure(null);
          conversation
            .compact({}, BACKGROUND_CONTEXT)
            .catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
        }}
      />
      <StickToBottom
        className="relative min-h-0 flex-1 overflow-y-hidden"
        initial="instant"
        resize="smooth"
        role="log"
        aria-label="Transcript"
      >
        <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {empty && <p className="mt-[25vh] text-center text-lg font-medium">What are we working on?</p>}
          {transcript.items.map((item) => (
            <TranscriptEntry key={item.key} item={item} />
          ))}
        </StickToBottom.Content>
        <ScrollToBottom />
      </StickToBottom>
      <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 pt-2 pb-4">
        {notices.map((notice) => (
          <Notice key={notice.id} notice={notice} />
        ))}
        {failure !== null && (
          <Notice notice={{ id: 0, tone: "error", title: "Could not compact the conversation", message: failure }} />
        )}
        <ChatComposer
          busy={transcript.busy}
          queued={transcript.queued}
          autoFocus
          onSend={(text, whenBusy) => conversation.submit({ text, whenBusy }, BACKGROUND_CONTEXT)}
          onStop={() => {
            conversation.abort(BACKGROUND_CONTEXT).catch((error: unknown) => console.error(error));
          }}
          status={<StatusBar conversation={conversation} agent={agent} usage={transcript.usage} />}
        />
      </div>
    </section>
  );
}

/** The conversation's title and directory, and its actions. */
function ChatHeader({ conversationId, onCompact }: { conversationId: number; onCompact: () => void }) {
  const { conversations } = useConnected();
  const summary = useReplicatedState(conversations.state)?.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
      <SidebarTrigger />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">{summary?.title ?? "New conversation"}</h1>
        <p className="truncate font-mono text-xs text-muted-foreground">{summary?.cwd}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Conversation actions" />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onCompact}>
              <FoldVerticalIcon />
              Compact the conversation
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function Notice({ notice }: { notice: ConversationNotice }) {
  return (
    <Alert variant={notice.tone === "error" ? "destructive" : "default"}>
      {notice.tone === "error" ? <AlertCircleIcon /> : <InfoIcon />}
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );
}

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      size="icon-sm"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full"
      aria-label="Scroll to the latest message"
      onClick={() => void scrollToBottom()}
    >
      <ArrowDownIcon />
    </Button>
  );
}
