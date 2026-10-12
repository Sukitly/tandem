import { type Static, Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { CommentBoard } from "./services/comments.ts";
import type { ConversationCatalog } from "./services/conversations.ts";

const parameters = Type.Object({
  threadId: Type.Integer({ description: "The comment's number, from its heading: 12 for `Comment #12`" }),
  text: Type.String({ description: "The reply, in Markdown" }),
});

/**
 * The agent's way to answer a review comment where it was written: the reply joins the comment's thread, beside the
 * code, in the project the conversation works in.
 */
export function commentTools(comments: CommentBoard, conversations: ConversationCatalog): Extension {
  return defineExtension({
    name: "tandem.comments",
    tools: [
      defineTool({
        name: "reply_to_comment",
        description:
          "Reply to a review comment of the user. The reply is shown in the comment's thread, beside the line of code " +
          "it is about.",
        parameters,
        async execute({ threadId, text }: Static<typeof parameters>, api, context) {
          const conversationId = api.conversationId as number;
          const result = await comments.replyAsAgent(
            { conversationId, workspaceId: conversations.workspaceOf(conversationId), threadId, text },
            api.commit,
            context,
          );
          return result.ok
            ? { content: [{ type: "text", text: `Replied to comment #${threadId}.` }] }
            : { content: [{ type: "text", text: result.reason }], isError: true };
        },
      }),
    ],
  });
}
