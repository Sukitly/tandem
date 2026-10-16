import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationNotice, ConversationSummary, ModelRef } from "@tandem/contracts";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  MessageCircleDashedIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SidebarToggle } from "@/app/sidebar.tsx";
import { useWorkbench } from "@/app/workbench.tsx";
import { useCommentThreads, waitingComments } from "@/comments/project-comments.ts";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useConversation } from "@/rpc/use-conversation.ts";
import { usePrompts } from "@/rpc/use-prompts.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChatComposer, imageSupportOf } from "./chat-composer.tsx";
import { ConversationMenu } from "./conversation-menu.tsx";
import { PullRequestLine } from "./pull-request-line.tsx";
import { type AgentChoice, StatusBar } from "./status-bar.tsx";
import { TpsLine } from "./tps-line.tsx";
import { toTranscript } from "./transcript.ts";
import { ChatError, TranscriptEntry, WaitingDots } from "./transcript-items.tsx";
import { UsageLine } from "./usage-line.tsx";

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
  return (
    <MessageScrollerProvider key={conversationId} autoScroll defaultScrollPosition="end">
      <OpenChat conversationId={conversationId} conversation={conversation} />
    </MessageScrollerProvider>
  );
}

/**
 * A new conversation, before its first message. It exists only here: sending the first message creates it on the
 * server with the model and thinking level chosen meanwhile, then it opens as any other.
 */
export function NewChat({ workspaceId }: { workspaceId: number }) {
  const { workspaces, conversations, models } = useConnected();
  const project = useReplicatedState(workspaces.state)?.workspaces.find((candidate) => candidate.id === workspaceId);
  const available = useReplicatedState(models.state);
  const { select, comments, reportFailure } = useWorkbench();
  const projectComments = comments(workspaceId);
  const threads = useCommentThreads(projectComments);
  const waiting = useMemo(() => waitingComments(threads), [threads]);
  const { commands } = usePrompts(workspaceId);
  const [chosen, setChosen] = useState<AgentChoice>({});
  // What the server starts with when none is chosen: the default model, else the first available.
  const first = available?.models[0];
  const model =
    chosen.model ??
    available?.defaultModel ??
    (first === undefined ? undefined : { provider: first.provider, modelId: first.modelId });
  // Like the server, follow the remembered thinking level where the model supports it.
  const levels = available?.models.find((candidate) => sameModel(candidate, model))?.thinkingLevels;
  const remembered = available?.defaultThinkingLevel;
  const thinkingLevel =
    chosen.thinkingLevel ??
    (remembered !== undefined && levels?.includes(remembered) === true ? remembered : undefined);
  const agent: AgentChoice = {
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };

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
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleDashedIcon />
          </EmptyMedia>
          <EmptyTitle>What should we build?</EmptyTitle>
          <EmptyDescription>
            The agent can read your code, run commands and make changes. Press send to start.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <ChatFooter>
        <PullRequestLine workspaceId={workspaceId} />
        <ChatComposer
          busy={false}
          queued={[]}
          comments={waiting}
          commands={commands}
          onWithdrawComment={(comment) =>
            projectComments
              .withdraw(comment.thread.id, comment.messageId)
              .catch((error: unknown) => reportFailure("Could not take back the comment", error))
          }
          autoFocus
          imageSupport={imageSupportOf(available?.models, agent.model)}
          onSend={async (text, sent, images) => {
            const id = await conversations.start(
              { workspaceId, text, comments: sent, ...(images.length === 0 ? {} : { images }), ...agent },
              BACKGROUND_CONTEXT,
            );
            select(id);
          }}
          onStop={() => {}}
          statusBar={<StatusBar agent={agent} usage={{ tokens: 0, cost: 0 }} onConfigure={configure} />}
          status={<UsageLine provider={agent.model?.provider} modelId={agent.model?.modelId} />}
        />
      </ChatFooter>
    </ChatFrame>
  );
}

function OpenChat({ conversationId, conversation }: { conversationId: number; conversation: Conversation }) {
  const { scrollToEnd } = useMessageScroller();
  const { conversations, models } = useConnected();
  const available = useReplicatedState(models.state);
  const { comments, reportFailure } = useWorkbench();
  const summary = useReplicatedState(conversations.state)?.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  // The project may have been removed since; then there are no comments to write.
  const projectComments = summary === undefined ? undefined : comments(summary.workspaceId);
  const threads = useCommentThreads(projectComments);
  const waiting = useMemo(() => waitingComments(threads), [threads]);
  const { commands } = usePrompts(summary?.workspaceId);
  const view = useReplicatedState(conversation.view);
  const tps = useReplicatedState(conversation.tps)?.last;
  const notices = useReplicatedState(conversation.notices)?.notices ?? [];
  const transcript = useMemo(() => (view === undefined ? undefined : toTranscript(view)), [view]);
  if (view === undefined || transcript === undefined) return null;
  const agent = view.docs["pi.agent"] as AgentChoice | undefined;

  return (
    <ChatFrame cwd={summary?.cwd} title={summary?.title} summary={summary}>
      <MessageScroller className="relative min-h-0 flex-1">
        <MessageScrollerViewport
          role="log"
          aria-label="Transcript"
          className="chat-transcript-scrollbar size-full min-h-0 min-w-0 overflow-y-auto scroll-fade-none"
        >
          <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {transcript.items.map((item) => (
              <MessageScrollerItem key={item.key} messageId={item.key}>
                <TranscriptEntry item={item} />
              </MessageScrollerItem>
            ))}
            <SilentGap silent={transcript.silent} turnHasContent={transcript.turnHasContent} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
      <ChatFooter>
        {notices.map((notice) => (
          <Notice key={notice.id} notice={notice} />
        ))}
        <PullRequestLine workspaceId={summary?.workspaceId} active={transcript.busy} />
        <ChatComposer
          busy={transcript.busy}
          queued={transcript.queued}
          comments={waiting}
          commands={commands}
          onWithdrawComment={(comment) =>
            projectComments
              ?.withdraw(comment.thread.id, comment.messageId)
              .catch((error: unknown) => reportFailure("Could not take back the comment", error))
          }
          autoFocus
          imageSupport={imageSupportOf(available?.models, agent?.model)}
          onSend={async (text, sent, images, whenBusy) => {
            await conversation.submit(
              { text, comments: sent, ...(images.length === 0 ? {} : { images }), whenBusy },
              BACKGROUND_CONTEXT,
            );
            // Sending is an explicit return to the live conversation, even after scrolling up to read history.
            scrollToEnd({ behavior: "auto" });
          }}
          onStop={() => {
            conversation.abort(BACKGROUND_CONTEXT).catch((error: unknown) => console.error(error));
          }}
          statusBar={
            <StatusBar
              agent={agent}
              usage={transcript.usage}
              onConfigure={(change) => conversation.configure(change, BACKGROUND_CONTEXT)}
            />
          }
          status={
            <div className="grid gap-1.5">
              <UsageLine provider={agent?.model?.provider} modelId={agent?.model?.modelId} active={transcript.busy} />
              {tps !== undefined && <TpsLine tps={tps} />}
            </div>
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
  summary,
  children,
}: {
  cwd: string | undefined;
  title: string | undefined;
  summary?: ConversationSummary;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" aria-label="Conversation">
      {/* As tall as the files panel's header beside it, so that their borders line up. */}
      <header className="flex h-13 min-w-0 shrink-0 items-center gap-2 border-b px-3">
        {/* On a narrow screen the sidebar is a drawer, out of sight, so the header opens it. */}
        <SidebarToggle className="md:hidden" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-muted-foreground">{cwd}</p>
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-sm font-medium">{title}</h1>
            {summary !== undefined && <ConversationMenu summary={summary} />}
          </div>
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
  const isMobile = useIsMobile();
  const label = filesShown ? "Hide files" : "Show files";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={filesShown}
      onClick={() => showFiles(!filesShown)}
    >
      {isMobile ? (
        filesShown ? (
          <ChevronDownIcon />
        ) : (
          <ChevronUpIcon />
        )
      ) : filesShown ? (
        <ChevronRightIcon />
      ) : (
        <ChevronLeftIcon />
      )}
    </Button>
  );
}

/** Under the transcript: notices and the message box. */
function ChatFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:gap-3">
      {children}
    </div>
  );
}

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  return a !== undefined && b !== undefined && a.provider === b.provider && a.modelId === b.modelId;
}

function Notice({ notice }: { notice: ConversationNotice }) {
  return <ChatError title="Notice" error={notice.message} />;
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
