import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationNotice } from "@tandem/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessageCircleDashedIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useDrafts, useMessageDraft } from "@/app/drafts.tsx";
import { useProjectResources } from "@/app/workbench.tsx";
import { useCommentThreads, waitingComments } from "@/comments/project-comments.ts";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { reportFailure } from "@/lib/errors.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useConversation, useConversationFailure } from "@/rpc/use-conversation.ts";
import { usePrompts } from "@/rpc/use-prompts.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChatComposer, imageSupportOf } from "./chat-composer.tsx";
import { ChatFooter, ChatFrame } from "./chat-frame.tsx";
import { PullRequestLine } from "./pull-request-line.tsx";
import { SilentGap } from "./silent-gap.tsx";
import { type AgentChoice, StatusBar } from "./status-bar.tsx";
import { TpsLine } from "./tps-line.tsx";
import { toTranscript } from "./transcript.ts";
import { ChatError, TranscriptEntry } from "./transcript-items.tsx";
import { UsageLine } from "./usage-line.tsx";
import { useAgentChoice } from "./use-agent-choice.ts";

/** One conversation: its header, transcript, and the message box. */
export function ChatView({ conversationId }: { conversationId: number }) {
  const conversation = useConversation(conversationId);
  const failure = useConversationFailure(conversationId);
  const { open } = useConnected();

  if (conversation === undefined && failure !== undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not open the conversation</EmptyTitle>
          <EmptyDescription role="alert">{failure.message}</EmptyDescription>
        </EmptyHeader>
        <div className="flex gap-2">
          <Button onClick={() => open.retry(conversationId)}>Retry</Button>
          <Link to="/" className={buttonVariants({ variant: "outline" })}>
            Back to workspace
          </Link>
        </div>
      </Empty>
    );
  }

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
  const drafts = useDrafts();
  const draftKey = `new:${workspaceId}`;
  const inputDraft = useMessageDraft(draftKey);
  const { workspaces, conversations, models } = useConnected();
  const project = useReplicatedState(workspaces.state)?.workspaces.find((candidate) => candidate.id === workspaceId);
  const available = useReplicatedState(models.state);
  const navigate = useNavigate();
  const resources = useProjectResources();
  const projectComments = resources.comments(workspaceId);
  const threads = useCommentThreads(projectComments);
  const waiting = useMemo(() => waitingComments(threads), [threads]);
  const { commands } = usePrompts(workspaceId);
  const { agent, configure } = useAgentChoice(available);

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
          draft={inputDraft}
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
            const moved = drafts?.move(draftKey, `conversation:${id}`);
            // The page for starting a conversation gives way to the conversation, which Back does not return to.
            void navigate({ to: "/c/$conversationId", params: { conversationId: String(id) }, replace: true });
            if (moved === "conflict") {
              reportFailure(
                "Conversation started; both drafts were kept",
                new Error(
                  "The conversation already has a draft. Any newer input remains in this project’s New conversation draft.",
                ),
              );
            }
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
  const [stopping, setStopping] = useState(false);
  const inputDraft = useMessageDraft(`conversation:${conversationId}`);
  const { scrollToEnd } = useMessageScroller();
  const { conversations, models } = useConnected();
  const available = useReplicatedState(models.state);
  const resources = useProjectResources();
  const summary = useReplicatedState(conversations.state)?.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  const projectComments = summary === undefined ? undefined : resources.comments(summary.workspaceId);
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
          draft={inputDraft}
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
            scrollToEnd({ behavior: "auto" });
          }}
          stopping={stopping}
          onStop={() => {
            if (stopping) return;
            setStopping(true);
            Promise.resolve()
              .then(() => conversation.abort(BACKGROUND_CONTEXT))
              .catch((error: unknown) => reportFailure("Could not stop the agent", error))
              .finally(() => setStopping(false));
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

function Notice({ notice }: { notice: ConversationNotice }) {
  return <ChatError title="Notice" error={notice.message} />;
}
