import type { ImageInput, ModelRef, ModelSummary, PromptTemplateSummary } from "@tandem/contracts";
import { ArrowUpIcon, PlusIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from "react";
import { useMessageDraft } from "@/app/drafts.tsx";
import type { MessageDraft } from "@/app/message-draft.ts";
import type { WaitingComment } from "@/comments/project-comments.ts";
import {
  PromptInput,
  PromptInputActionButton,
  PromptInputActions,
  PromptInputSubmitButton,
  PromptInputTextarea,
} from "@/components/ai-elements/index.ts";
import { FieldError } from "@/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { preferences } from "@/lib/preferences.ts";
import { IMAGE_ACCEPT } from "./attached-images.ts";
import { CommandSuggestions } from "./command-suggestions.tsx";
import { ComposerAttachments } from "./composer-attachments.tsx";
import { ComposerContext, ComposerDetails } from "./composer-context.tsx";
import {
  ComposerOptions,
  KEYBOARD_MODE_KEY,
  type KeyboardMode,
  SEND_MODE_KEY,
  type SendMode,
  storedKeyboardMode,
  storedSendMode,
} from "./composer-options.tsx";
import type { QueuedMessage } from "./transcript.ts";
import { completeCommand, useCommandCompletion } from "./use-command-completion.ts";
import { useComposerImages } from "./use-composer-images.ts";
import { useComposerKeyboard } from "./use-composer-keyboard.ts";
import { useComposerText } from "./use-composer-text.ts";

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
 * The message box. Desktop Enter always steers; mobile uses its chosen send mode (steering by default).
 * Alt+Enter explicitly queues a follow-up on either layout.
 * Shift+Enter starts a new line. Platform editing is the default; Emacs shortcuts are an explicit preference.
 *
 * The box is a combobox, and its suggestion menu is Tandem's own, laid over the box rather than rendered by a popover
 * or a menu component: focus must stay in the box so that ordinary typing, spaces, and Shift+Enter keep working, and
 * such a component would take the keys for itself. It follows how pi's own input behaves: a message that begins with
 * `/` and holds no argument yet offers the project's slash commands, the arrows move through them, Tab fills the
 * highlighted one into the box so its arguments can be typed, Enter sends it, Escape puts the menu away, and
 * optional Emacs editing keys are handled by the box; everything else is left to the browser.
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
  const {
    text,
    images: attached,
    sending,
    error,
  } = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const images = useComposerImages(draft, imageSupport);
  const { dragging, picker, attach, onPaste, onDragOver, onDrop } = images;
  const [keyboardMode, setKeyboardMode] = useState(storedKeyboardMode);
  const mobile = useIsMobile();
  const [mobileSendMode, setSendMode] = useState(storedSendMode);
  const sendMode = mobile ? mobileSendMode : "steer";
  const chooseSendMode = (mode: SendMode): void => {
    setSendMode(mode);
    preferences.setItem(SEND_MODE_KEY, mode);
  };
  const chooseKeyboard = (mode: KeyboardMode): void => {
    setKeyboardMode(mode);
    preferences.setItem(KEYBOARD_MODE_KEY, mode);
  };
  const menu = useCommandCompletion(text, commands, sending);
  const editor = useComposerText(
    (value) => {
      draft.setText(value);
      menu.reset();
      keyboard.resetColumn();
    },
    text,
    keyboardMode === "emacs",
  );
  const { value, textareaRef } = editor;
  const empty = value.trim() === "" && comments.length === 0 && attached.length === 0;

  const accept = (command: PromptTemplateSummary): void => {
    editor.setText(completeCommand(command));
    menu.reset();
  };

  const send = async (text: string, whenBusy: "steer" | "followUp"): Promise<void> => {
    if (sending) return;
    if (text.trim() === "" && comments.length === 0 && attached.length === 0) return;
    await draft.send((sent) =>
      onSend(
        text,
        comments.map((comment) => comment.messageId),
        sent.map((image) => image.input),
        whenBusy,
      ),
    );
  };

  const keyboard = useComposerKeyboard({ editor, keyboardMode, menu, send, sendMode, accept });
  const { composition, onKeyDown } = keyboard;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send(value, sendMode);
  };

  return (
    <div data-composer className="grid min-w-0 gap-2">
      <ComposerContext comments={comments} queued={queued} onWithdrawComment={onWithdrawComment} />
      <div ref={menu.boxRef} className="relative">
        <CommandSuggestions
          completion={menu}
          onAccept={(command) => {
            accept(command);
            textareaRef.current?.focus({ preventScroll: true });
          }}
        />
        <form
          onSubmit={onSubmit}
          onDragOver={onDragOver}
          onDragLeave={images.onDragLeave}
          onDrop={onDrop}
          aria-label="Message box"
          className="relative"
        >
          {/* Where a dragged image would land: a layer of the composer's own over the box, which keeps its look. */}
          {dragging && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-ring bg-background/60"
            />
          )}
          <PromptInput>
            <ComposerAttachments attached={attached} onDetach={(id) => draft.detach(id)} />
            <PromptInputTextarea
              ref={textareaRef}
              className="max-h-[min(16rem,20dvh)] overflow-y-auto overscroll-contain"
              defaultValue={editor.initialValue}
              onChange={(event) => editor.change(event.target)}
              onSelect={editor.rememberSelection}
              onPointerDown={() => {
                keyboard.resetColumn();
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionStart={() => {
                composition.onCompositionStart();
                editor.compositionStart();
              }}
              onCompositionEnd={(event) => {
                editor.compositionEnd(event.currentTarget);
                composition.onCompositionEnd();
              }}
              rows={1}
              aria-label="Message"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={menu.open}
              aria-controls={menu.open ? menu.listId : undefined}
              aria-activedescendant={menu.selected >= 0 ? menu.optionId(menu.selected) : undefined}
              placeholder={
                busy
                  ? sendMode === "followUp"
                    ? "Queue a follow-up"
                    : "Steer the agent, or Alt+Enter to queue a follow-up"
                  : "Ask the agent"
              }
              autoFocus={autoFocus}
            />
            <PromptInputActions className="flex-wrap">
              {imageSupport.kind === "accepted" && (
                <>
                  <input
                    ref={picker}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    multiple
                    hidden
                    onChange={(event) => {
                      void attach([...(event.target.files ?? [])]);
                      event.target.value = "";
                    }}
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <PromptInputActionButton
                          type="button"
                          aria-label="Attach images"
                          onClick={() => picker.current?.click()}
                        />
                      }
                    >
                      <PlusIcon />
                    </TooltipTrigger>
                    <TooltipContent>Attach images, or paste or drop them</TooltipContent>
                  </Tooltip>
                </>
              )}
              {statusBar !== undefined && <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">{statusBar}</div>}
              <ComposerOptions
                mobile={mobile}
                keyboard={keyboardMode}
                onKeyboard={chooseKeyboard}
                mode={sendMode}
                onMode={chooseSendMode}
              />
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {busy && (
                  <PromptInputSubmitButton type="button" aria-label="Stop" disabled={stopping} onClick={onStop}>
                    <SquareIcon />
                  </PromptInputSubmitButton>
                )}
                <PromptInputSubmitButton
                  type="submit"
                  aria-label="Send"
                  title={busy && sendMode === "followUp" ? "Queue follow-up" : "Send"}
                  disabled={empty || sending}
                >
                  <ArrowUpIcon />
                </PromptInputSubmitButton>
              </div>
            </PromptInputActions>
          </PromptInput>
        </form>
      </div>
      {status !== undefined && (
        <ComposerDetails label="Usage and run metrics">
          <div className="max-h-[20dvh] overflow-y-auto overscroll-contain">{status}</div>
        </ComposerDetails>
      )}
      {error !== null && <FieldError>{error}</FieldError>}
    </div>
  );
}
