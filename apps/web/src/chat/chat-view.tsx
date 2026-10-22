import { Link } from "@tanstack/react-router";
import { MessageListProvider } from "@/components/agent/message-list.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useConversation, useConversationFailure } from "@/rpc/use-conversation.ts";
import { OpenChat } from "./open-chat.tsx";

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
    <MessageListProvider key={conversationId} autoScroll defaultScrollPosition="end">
      <OpenChat conversationId={conversationId} conversation={conversation} />
    </MessageListProvider>
  );
}
