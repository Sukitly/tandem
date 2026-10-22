import type { ImageInput, ModelRef, ModelSummary, PromptTemplateSummary } from "@tandem/contracts";
import { type KeyboardEvent, type ReactNode, useSyncExternalStore } from "react";
import { useMessageDraft } from "@/app/drafts.tsx";
import type { MessageDraft } from "@/app/message-draft.ts";
import { userPreferences } from "@/app/user-preferences.ts";
import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import {
  PromptInput,
  PromptInputAttachButton,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBox,
  PromptInputCommands,
  PromptInputFooter,
  PromptInputQueue,
  PromptInputQueueItem,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/agent/prompt-input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { FieldError } from "@/components/ui/field";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { usePreference } from "@/lib/preferences.ts";
import { IMAGE_ACCEPT } from "./attached-images.ts";
import { attachFiles, placeholderOf, submitTitle } from "./composer-actions.tsx";
import { ComposerOptions, type SendMode } from "./composer-options.tsx";
import type { QueuedMessage } from "./transcript.ts";

/**
 * What the composer knows of the current model's images: it takes them (at most `maxPerMessage` in a message, if it
 * says), it takes none, or there is no model that can answer, which the server refuses images for too.
 */
export type ImageSupport = { kind: "accepted"; maxPerMessage?: number } | { kind: "none" } | { kind: "unknown" };

/** What `model` takes of images, among the available models; a model that is not among them answers nothing. */
export function imageSupportOf(models: readonly ModelSummary[] | undefined, model: ModelRef | undefined): ImageSupport {
  const summary = models?.find(
    (candidate) => model !== undefined && candidate.provider === model.provider && candidate.modelId === model.modelId,
  );
  if (summary === undefined) return { kind: "unknown" };
  if (summary.images === undefined) return { kind: "none" };
  return { kind: "accepted", ...summary.images };
}

export interface ChatComposerProps {
  draft?: MessageDraft;
  busy: boolean;
  stopping?: boolean;
  queued: QueuedMessage[];
  /** Comments of the project waiting to be sent; they go with the message, which the server writes them into. */
  comments?: WaitingComment[];
  onWithdrawComment?(comment: WaitingComment): void;
  /** The project's slash commands, offered while a message begins with `/`. The server expands them when it is sent. */
  commands?: PromptTemplateSummary[];
  /** Rejects when the server refuses the message; the text and images then stay in the box, and the comments wait. */
  onSend: (text: string, comments: number[], images: ImageInput[], whenBusy: "steer" | "followUp") => Promise<void>;
  /** Whether the current model takes images; images are offered only when it does. */
  imageSupport: ImageSupport;
  onStop: () => void;
  autoFocus?: boolean;
  /** Shown inside the box's action row: model, thinking level, and context usage. */
  statusBar?: ReactNode;
  /** Shown under the box: provider quota usage and throughput metrics. */
  status?: ReactNode;
}

/**
 * Escape stops the agent once and only by itself: a held key repeats, and with a modifier it is another shortcut's.
 * The box stops the agent on any Escape, so the ones that must not are taken from it here, before it sees them.
 */
function stopsOnlyOnce(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Escape") return;
  if (event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) event.preventDefault();
}

/**
 * The message box. Enter sends, and while the agent works it steers the turn; Alt+Enter queues a follow-up instead.
 * Shift+Enter starts a new line, and Escape stops the agent, as the Stop button does. A narrow layout sends in the way
 * it chose in the options, since a phone has no Alt+Enter, and on a touch screen Enter breaks the line and the button
 * sends.
 *
 * Messages sent while the agent works wait above the box, one line each, until the agent takes them up. The comments of
 * the project that wait to be sent are above them: they are not sent yet, and go with the next message.
 *
 * A message that begins with `/` and holds no argument yet offers the project's slash commands: the arrows move through
 * them, Tab fills the highlighted one into the box so its arguments can be typed, Enter sends it, and Escape puts the
 * menu away (or, with no menu, stops the agent). The server expands the command when the message is sent.
 */
export function ChatComposer({
  draft: suppliedDraft,
  busy,
  stopping = false,
  queued,
  comments = [],
  onWithdrawComment,
  commands = [],
  onSend,
  onStop,
  autoFocus,
  statusBar,
  status,
  imageSupport,
}: ChatComposerProps) {
  const localDraft = useMessageDraft();
  const draft = suppliedDraft ?? localDraft;
  const { text, images: attached, error } = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const mobile = useIsMobile();
  const [mobileSendMode, chooseSendMode] = usePreference(userPreferences.sendMode);
  const sendMode: SendMode = mobile ? mobileSendMode : "steer";
  // Comments and images go with a message, so it can be sent with no text.
  const hasContext = comments.length > 0 || attached.length > 0;

  // The box clears itself when a send resolves with anything but `false`, so this always resolves with it: the draft
  // does the clearing, and only when the text is still the one that was sent. The box cannot know that, as a send may
  // finish in another view of the same draft, after more was typed there. A refused message stays; the draft says why.
  const send = async (message: string, whenBusy: SendMode): Promise<false> => {
    await draft.send((sent) =>
      onSend(
        message,
        comments.map((comment) => comment.messageId),
        sent.map((image) => image.input),
        whenBusy,
      ),
    );
    return false;
  };
  const sendAsChosen = (message: string) => send(message, sendMode);
  const sendAsFollowUp = (message: string) => send(message, "followUp");

  return (
    <div data-composer className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      {comments.length > 0 && (
        <div className="max-h-[15dvh] overflow-y-auto overscroll-contain">
          <CommentList comments={comments} onWithdraw={(comment) => onWithdrawComment?.(comment)} />
        </div>
      )}
      <PromptInput
        // The footer around it is the column already.
        className="max-w-none px-0"
        value={text}
        onValueChange={(value) => draft.setText(value)}
        onSubmit={sendAsChosen}
        onSteer={sendAsChosen}
        onFollowUp={sendAsFollowUp}
        streaming={busy}
        // Escape and the Stop button do nothing once the agent is stopping.
        onStop={busy && !stopping ? onStop : undefined}
        allowEmpty={hasContext}
        onAddFiles={(files) => void attachFiles(draft, imageSupport, files)}
        dropLabel="Drop images to attach"
      >
        {/* Messages already sent, which the agent has not taken up yet: joined to the box, one line each. */}
        <PromptInputQueue>
          {queued.map((message) => (
            <PromptInputQueueItem
              key={message.id}
              kind={message.mode === "steer" ? "steering" : "follow-up"}
              attachments={message.imageCount}
              attachmentsLabel={message.imageCount === 1 ? "1 image" : `${message.imageCount} images`}
            >
              {message.text}
            </PromptInputQueueItem>
          ))}
        </PromptInputQueue>
        <PromptInputBox>
          <PromptInputAttachments aria-label="Images">
            {attached.map((image) => (
              <PromptInputAttachment
                key={image.id}
                name={image.name}
                src={image.url}
                onRemove={() => draft.detach(image.id)}
              />
            ))}
          </PromptInputAttachments>
          <PromptInputTextarea
            aria-label="Message"
            placeholder={placeholderOf(busy, sendMode, mobile)}
            autoFocus={autoFocus}
            // As high as the box allows, and no higher than a fifth of a short screen, which a keyboard has halved.
            className="max-h-[min(12rem,20dvh)] overscroll-contain"
            onKeyDown={stopsOnlyOnce}
          />
          <PromptInputCommands
            commands={commands.map((command) => ({
              id: `${command.origin}/${command.name}`,
              name: command.name,
              description: command.description,
              badge: <Badge variant="outline">{command.origin === "project" ? "Project" : "Global"}</Badge>,
            }))}
          />
          <PromptInputToolbar>
            {imageSupport.kind === "accepted" && (
              <PromptInputAttachButton
                accept={IMAGE_ACCEPT}
                label="Attach images"
                title="Attach images, or paste or drop them"
                className="mr-auto"
              />
            )}
            {statusBar !== undefined && <div className="flex min-w-0 flex-1">{statusBar}</div>}
            {mobile && <ComposerOptions mode={mobileSendMode} onMode={chooseSendMode} />}
            <PromptInputSubmit title={submitTitle(busy, text.trim() === "" && !hasContext, sendMode)} />
          </PromptInputToolbar>
        </PromptInputBox>
        {status !== undefined && (
          <PromptInputFooter data-dense className="max-h-[20dvh] overflow-y-auto overscroll-contain">
            {status}
          </PromptInputFooter>
        )}
      </PromptInput>
      {error !== null && <FieldError>{error}</FieldError>}
    </div>
  );
}
