import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationNotice } from "@tandem/contracts";
import { AlertCircleIcon, ArrowDownIcon, InfoIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useConnected } from "@/rpc/connection.tsx";
import { useConversation } from "@/rpc/use-conversation.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChatComposer } from "./chat-composer.tsx";
import { type AgentChoice, StatusBar } from "./status-bar.tsx";
import { toTranscript } from "./transcript.ts";
import { TranscriptEntry, WaitingDots } from "./transcript-items.tsx";

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
  const transcript = useMemo(() => (view === undefined ? undefined : toTranscript(view)), [view]);
  if (view === undefined || transcript === undefined) return null;
  const empty = transcript.items.length === 0;
  const agent = view.docs["pi.agent"] as AgentChoice | undefined;

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" aria-label="Conversation">
      <ChatHeader conversationId={conversationId} />
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
          <SilentGap silent={transcript.silent} turnHasContent={transcript.turnHasContent} />
        </StickToBottom.Content>
        <ScrollToBottom />
      </StickToBottom>
      <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 pt-2 pb-4">
        {notices.map((notice) => (
          <Notice key={notice.id} notice={notice} />
        ))}
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

/** The conversation's title and directory. */
function ChatHeader({ conversationId }: { conversationId: number }) {
  const { conversations } = useConnected();
  const summary = useReplicatedState(conversations.state)?.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
      {/* On a narrow screen the sidebar is a drawer, out of sight, so the header opens it. */}
      <SidebarTrigger className="md:hidden" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">{summary?.title ?? "New conversation"}</h1>
        <p className="truncate font-mono text-xs text-muted-foreground">{summary?.cwd}</p>
      </div>
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

/**
 * How long the agent may be silent between two visible steps before the dots show, so that the short hand-offs
 * between a tool and the next answer do not flash them. Before the turn has shown anything, they show at once.
 */
const SILENT_GAP_MS = 2000;

/** The waiting dots at the end of the transcript, while the agent works and nothing on screen moves. */
function SilentGap({ silent, turnHasContent }: { silent: boolean; turnHasContent: boolean }) {
  const [sustained, setSustained] = useState(false);
  useEffect(() => {
    if (!silent) {
      setSustained(false);
      return;
    }
    const timer = setTimeout(() => setSustained(true), SILENT_GAP_MS);
    return () => clearTimeout(timer);
  }, [silent]);
  if (!silent || (turnHasContent && !sustained)) return null;
  return <WaitingDots />;
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
