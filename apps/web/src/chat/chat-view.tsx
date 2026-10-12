import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationNotice, ModelRef } from "@tandem/contracts";
import { AlertCircleIcon, ArrowDownIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { useWorkbench } from "@/app/workbench.tsx";
import { useCommentDrafts } from "@/comments/comment-drafts.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

/**
 * A new conversation, before its first message. It exists only here: sending the first message creates it on the
 * server with the model and thinking level chosen meanwhile, then it opens as any other.
 */
export function NewChat({ workspaceId }: { workspaceId: number }) {
  const { workspaces, conversations, models } = useConnected();
  const project = useReplicatedState(workspaces.state)?.workspaces.find((candidate) => candidate.id === workspaceId);
  const available = useReplicatedState(models.state);
  const { select, comments } = useWorkbench();
  const drafts = comments(workspaceId);
  const waiting = useCommentDrafts(drafts);
  const [chosen, setChosen] = useState<AgentChoice>({});
  // What the server starts with when none is chosen: the default model, else the first available.
  const first = available?.models[0];
  const model =
    chosen.model ??
    available?.defaultModel ??
    (first === undefined ? undefined : { provider: first.provider, modelId: first.modelId });
  const agent: AgentChoice = { ...(model === undefined ? {} : { model }), ...pick(chosen, "thinkingLevel") };

  const configure = async (change: AgentChoice): Promise<void> => {
    setChosen((current) => {
      const next = { ...current, ...change };
      // Like the server, keep the thinking level only where the new model has it.
      const levels = available?.models.find((candidate) => sameModel(candidate, next.model))?.thinkingLevels;
      if (
        change.model !== undefined &&
        next.thinkingLevel !== undefined &&
        levels?.includes(next.thinkingLevel) !== true
      )
        delete next.thinkingLevel;
      return next;
    });
  };

  return (
    <ChatFrame cwd={project?.path} title="New conversation">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>What are we working on?</EmptyTitle>
        </EmptyHeader>
      </Empty>
      <ChatFooter>
        <ChatComposer
          busy={false}
          queued={[]}
          comments={waiting}
          onRemoveComment={(id) => drafts.remove(id)}
          autoFocus
          onSend={async (text) => {
            const id = await conversations.start({ workspaceId, text, ...agent }, BACKGROUND_CONTEXT);
            select(id);
          }}
          onSent={() => drafts.clear()}
          onStop={() => {}}
          status={<StatusBar agent={agent} usage={{ tokens: 0, cost: 0 }} onConfigure={configure} />}
        />
      </ChatFooter>
    </ChatFrame>
  );
}

function OpenChat({ conversationId, conversation }: { conversationId: number; conversation: Conversation }) {
  const { conversations } = useConnected();
  const { comments } = useWorkbench();
  const summary = useReplicatedState(conversations.state)?.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  // The project may have been removed since; then there are no comments to write.
  const drafts = summary === undefined ? undefined : comments(summary.workspaceId);
  const waiting = useCommentDrafts(drafts);
  const view = useReplicatedState(conversation.view);
  const notices = useReplicatedState(conversation.notices)?.notices ?? [];
  const transcript = useMemo(() => (view === undefined ? undefined : toTranscript(view)), [view]);
  if (view === undefined || transcript === undefined) return null;
  const agent = view.docs["pi.agent"] as AgentChoice | undefined;

  return (
    <ChatFrame cwd={summary?.cwd} title={summary?.title}>
      <StickToBottom
        className="relative min-h-0 flex-1 overflow-y-hidden"
        initial="instant"
        resize="smooth"
        role="log"
        aria-label="Transcript"
      >
        <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {transcript.items.map((item) => (
            <TranscriptEntry key={item.key} item={item} />
          ))}
          <SilentGap silent={transcript.silent} turnHasContent={transcript.turnHasContent} />
        </StickToBottom.Content>
        <ScrollToBottom />
      </StickToBottom>
      <ChatFooter>
        {notices.map((notice) => (
          <Notice key={notice.id} notice={notice} />
        ))}
        <ChatComposer
          busy={transcript.busy}
          queued={transcript.queued}
          comments={waiting}
          onRemoveComment={(id) => drafts?.remove(id)}
          autoFocus
          onSend={(text, whenBusy) => conversation.submit({ text, whenBusy }, BACKGROUND_CONTEXT)}
          onSent={() => drafts?.clear()}
          onStop={() => {
            conversation.abort(BACKGROUND_CONTEXT).catch((error: unknown) => console.error(error));
          }}
          status={
            <StatusBar
              agent={agent}
              usage={transcript.usage}
              onConfigure={(change) => conversation.configure(change, BACKGROUND_CONTEXT)}
            />
          }
        />
      </ChatFooter>
    </ChatFrame>
  );
}

/** A conversation's page: the header with its directory and title, then the content. */
function ChatFrame({
  cwd,
  title,
  children,
}: {
  cwd: string | undefined;
  title: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" aria-label="Conversation">
      {/* As tall as the files panel's header beside it, so that their borders line up. */}
      <header className="flex h-13 min-w-0 shrink-0 items-center gap-2 border-b px-3">
        {/* On a narrow screen the sidebar is a drawer, out of sight, so the header opens it. */}
        <SidebarTrigger className="md:hidden" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-muted-foreground">{cwd}</p>
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </div>
        <FilesToggle />
      </header>
      {children}
    </section>
  );
}

/** Shows or hides the files panel beside the conversation. */
function FilesToggle() {
  const { filesShown, showFiles } = useWorkbench();
  const label = filesShown ? "Hide files" : "Show files";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={filesShown}
            onClick={() => showFiles(!filesShown)}
          />
        }
      >
        {filesShown ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Under the transcript: notices and the message box. */
function ChatFooter({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 pt-2 pb-4">{children}</div>;
}

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  return a !== undefined && b !== undefined && a.provider === b.provider && a.modelId === b.modelId;
}

function pick<T extends object, K extends keyof T>(value: T, key: K): Partial<Pick<T, K>> {
  return value[key] === undefined ? {} : ({ [key]: value[key] } as Partial<Pick<T, K>>);
}

function Notice({ notice }: { notice: ConversationNotice }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>No answer</AlertTitle>
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
      className="absolute bottom-3 left-1/2 -translate-x-1/2"
      aria-label="Scroll to the latest message"
      onClick={() => void scrollToBottom()}
    >
      <ArrowDownIcon />
    </Button>
  );
}
