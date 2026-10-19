import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, ConversationNotice } from "@tandem/contracts";
import { useMemo, useState } from "react";
import { useMessageDraft } from "@/app/drafts.tsx";
import { useProjectResources } from "@/app/workbench.tsx";
import { useCommentThreads, waitingComments } from "@/comments/project-comments.ts";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller.tsx";
import { reportFailure } from "@/lib/errors.ts";
import { useConnected } from "@/rpc/connection.tsx";
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

export function OpenChat({ conversationId, conversation }: { conversationId: number; conversation: Conversation }) {
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
