import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircleDashedIcon } from "lucide-react";
import { useMemo } from "react";
import { useDrafts, useMessageDraft } from "@/app/drafts.tsx";
import { useProjectResources } from "@/app/workbench.tsx";
import { useCommentThreads, waitingComments } from "@/comments/project-comments.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { reportFailure } from "@/lib/errors.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { usePrompts } from "@/rpc/use-prompts.ts";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ChatComposer, imageSupportOf } from "./chat-composer.tsx";
import { ChatFooter, ChatFrame } from "./chat-frame.tsx";
import { PullRequestLine } from "./pull-request-line.tsx";
import { StatusBar } from "./status-bar.tsx";
import { UsageLine } from "./usage-line.tsx";
import { useAgentChoice } from "./use-agent-choice.ts";

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
