import type { ImageInput, ModelRef, ModelSummary, PromptTemplateSummary } from "@tandem/contracts";
import { cn } from "cn";
import { ArrowUpIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useMessageDraft } from "@/app/drafts.tsx";
import type { MessageDraft } from "@/app/message-draft.ts";
import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import {
  PromptInput,
  PromptInputActionButton,
  PromptInputActions,
  PromptInputAttachments,
  PromptInputSubmitButton,
  PromptInputTextarea,
} from "@/components/ai-elements/index.ts";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldError } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompositionGuard } from "@/hooks/use-composition-guard.ts";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { preferences } from "@/lib/preferences.ts";
import { IMAGE_ACCEPT, imageFiles } from "./attached-images.ts";
import {
  ComposerOptions,
  KEYBOARD_MODE_KEY,
  type KeyboardMode,
  SEND_MODE_KEY,
  type SendMode,
  storedKeyboardMode,
  storedSendMode,
} from "./composer-options.tsx";
import { emacsColumn, emacsEdit } from "./emacs-edit.ts";
import type { QueuedMessage } from "./transcript.ts";
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
  const [dragging, setDragging] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(storedKeyboardMode);
  const mobile = useIsMobile();
  const [mobileSendMode, setSendMode] = useState(storedSendMode);
  const sendMode = mobile ? mobileSendMode : "steer";
  const chooseSendMode = (mode: SendMode): void => {
    setSendMode(mode);
    try {
      preferences.setItem(SEND_MODE_KEY, mode);
    } catch {
      /* Preferences are optional. */
    }
  };
  const chooseKeyboard = (mode: KeyboardMode): void => {
    setKeyboardMode(mode);
    try {
      preferences.setItem(KEYBOARD_MODE_KEY, mode);
    } catch {
      /* Preferences are optional. */
    }
  };
  const picker = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const killedText = useRef("");
  const verticalGoal = useRef<{ column: number; position: number } | null>(null);
  const composition = useCompositionGuard();
  const editor = useComposerText(
    (value) => {
      draft.setText(value);
      verticalGoal.current = null;
      setHighlight(0);
      setDismissed(false);
    },
    text,
    keyboardMode === "emacs",
  );
  const { value, textareaRef } = editor;
  const empty = value.trim() === "" && comments.length === 0 && attached.length === 0;

  const attach = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    if (imageSupport.kind !== "accepted") {
      draft.setError(
        imageSupport.kind === "none"
          ? "The current model does not take images. Choose one that does."
          : "Choose an available model before sending images.",
      );
      return;
    }
    await draft.attach(files, imageSupport.maxPerMessage);
  };

  const query = commandQuery(value);
  const matching =
    query === null ? [] : commands.filter((command) => command.name.toLowerCase().startsWith(query.toLowerCase()));
  const menuOpen = query !== null && !dismissed && matching.length > 0 && !sending;
  const selected = menuOpen ? Math.min(highlight, matching.length - 1) : -1;
  const optionId = (index: number): string => `${listId}-${index}`;

  // Focus stays in the box, so the browser does not scroll the highlighted row into view when the arrows move it.
  useEffect(() => {
    if (selected < 0) return;
    document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, selected]);

  // A press outside the box and its menu puts the menu away. Presses on the box, its buttons, or the menu itself do
  // not: the box owns when the menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && boxRef.current?.contains(event.target) === true) return;
      setDismissed(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpen]);

  const accept = (command: PromptTemplateSummary): void => {
    editor.setText(completion(command));
    setHighlight(0);
    setDismissed(false);
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composition.owns(event)) return;
    if (event.getModifierState("AltGraph")) return;
    if (editor.keyDown(event)) {
      verticalGoal.current = null;
      return;
    }
    const emacsControl =
      keyboardMode === "emacs" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

    if (menuOpen) {
      const count = matching.length;
      if (event.key === "ArrowDown" || (emacsControl && event.key.toLowerCase() === "n")) {
        verticalGoal.current = null;
        event.preventDefault();
        setHighlight((current) => (current + 1) % count);
        return;
      }
      if (event.key === "ArrowUp" || (emacsControl && event.key.toLowerCase() === "p")) {
        verticalGoal.current = null;
        event.preventDefault();
        setHighlight((current) => (current - 1 + count) % count);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        // Tab fills the command into the box and closes the menu, so its arguments can be typed; Shift+Tab puts the
        // menu away, so the two never disagree.
        if (event.shiftKey) setDismissed(true);
        else {
          const command = matching[selected];
          if (command !== undefined) accept(command);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      // Enter settles the highlighted command and sends it in one gesture, as pi's editor does for slash commands.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const command = matching[selected];
        const message = command === undefined ? value : completion(command);
        if (message !== value) editor.setText(message);
        void send(message, event.altKey ? "followUp" : sendMode);
        return;
      }
    }
    const textarea = event.currentTarget;
    const vertical = emacsControl && (event.key.toLowerCase() === "p" || event.key.toLowerCase() === "n");
    const cursor = textarea.selectionDirection === "backward" ? textarea.selectionStart : textarea.selectionEnd;
    const goal = verticalGoal.current;
    const column = vertical
      ? goal !== null && textarea.selectionStart === goal.position && textarea.selectionEnd === goal.position
        ? goal.column
        : emacsColumn(value, cursor)
      : undefined;
    const modifier = event.key === "Control" || event.key === "Alt" || event.key === "Meta" || event.key === "Shift";
    if (!vertical && !modifier) verticalGoal.current = null;
    const edit =
      keyboardMode === "emacs"
        ? emacsEdit(
            textarea.value,
            textarea.selectionStart,
            textarea.selectionEnd,
            textarea.selectionDirection,
            event,
            killedText.current,
            column,
          )
        : null;
    if (edit !== null) {
      event.preventDefault();
      if (edit.kind === "move") {
        textarea.setSelectionRange(edit.position, edit.position);
        if (column !== undefined) verticalGoal.current = { column, position: edit.position };
      } else if (edit.start !== edit.end || edit.text !== "") {
        if (edit.kill) killedText.current = textarea.value.slice(edit.start, edit.end);
        editor.setText(
          textarea.value.slice(0, edit.start) + edit.text + textarea.value.slice(edit.end),
          edit.start + edit.text.length,
        );
      }
      return;
    }
    // Ordinary characters and spaces, which close the menu by changing the message, and Shift+Enter's line break
    // remain the browser's.
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send(value, event.altKey ? "followUp" : sendMode);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send(value, sendMode);
  };

  // A pasted image is attached; pasted text goes into the box as usual.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = imageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void attach(files);
  };

  const onDragOver = (event: DragEvent<HTMLFormElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>): void => {
    setDragging(false);
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    void attach(imageFiles(event.dataTransfer));
  };

  return (
    <div data-composer className="grid min-w-0 gap-2">
      {(comments.length > 0 || queued.length > 0) && (
        <ComposerDetails label={`${queued.length} queued messages · ${comments.length} review comments`}>
          <section
            className="grid max-h-[15dvh] gap-2 overflow-y-auto overscroll-contain"
            aria-label="Pending message context"
          >
            <CommentList comments={comments} onWithdraw={(comment) => onWithdrawComment?.(comment)} />
            {queued.length > 0 && (
              <ItemGroup aria-label="Queued messages" className="gap-1">
                {queued.map((message) => (
                  <Item key={message.id} size="xs" variant="muted">
                    <Badge variant="outline">{message.mode === "steer" ? "Steering" : "Follow-up"}</Badge>
                    <ItemContent className="min-w-0">
                      <ItemDescription className="line-clamp-none whitespace-pre-wrap wrap-anywhere">
                        {message.text}
                      </ItemDescription>
                    </ItemContent>
                    {message.imageCount > 0 && (
                      <Badge variant="secondary">
                        {message.imageCount === 1 ? "1 image" : `${message.imageCount} images`}
                      </Badge>
                    )}
                  </Item>
                ))}
              </ItemGroup>
            )}
          </section>
        </ComposerDetails>
      )}
      <div ref={boxRef} className="relative">
        {menuOpen && (
          <div className="absolute bottom-full left-0 z-10 mb-2 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
            <p className="border-b px-2.5 py-1.5 text-xs text-muted-foreground">
              {query === "" ? "Commands" : `Commands matching /${query}`}
            </p>
            <div id={listId} role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto p-1">
              {matching.map((command, index) => (
                <button
                  key={commandValue(command)}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  className={cn(
                    "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none",
                    index === selected && "bg-muted text-foreground",
                  )}
                  // Prevent pointer focus from leaving the combobox, but activate via click for all input methods.
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    accept(command);
                    textareaRef.current?.focus({ preventScroll: true });
                  }}
                  // mousemove, not mouseenter: rows moving under a resting pointer must not take the highlight back.
                  onMouseMove={() => {
                    if (index !== selected) setHighlight(index);
                  }}
                >
                  <span className="shrink-0 font-mono">/{command.name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{command.description}</span>
                  <Badge variant="outline">{command.origin === "project" ? "Project" : "Global"}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}
        <form
          onSubmit={onSubmit}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
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
            {attached.length > 0 && (
              <PromptInputAttachments className="max-h-[10dvh] overflow-y-auto overscroll-contain">
                {attached.map((image) => (
                  <Attachment key={image.id} size="sm">
                    <AttachmentMedia variant="image">
                      <img src={image.url} alt={image.name} className="size-full object-cover" />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{image.name}</AttachmentTitle>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction aria-label={`Remove ${image.name}`} onClick={() => draft.detach(image.id)}>
                        <XIcon />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                ))}
              </PromptInputAttachments>
            )}
            <PromptInputTextarea
              ref={textareaRef}
              className="max-h-[min(16rem,20dvh)] overflow-y-auto overscroll-contain"
              defaultValue={editor.initialValue}
              onChange={(event) => editor.change(event.target)}
              onSelect={editor.rememberSelection}
              onPointerDown={() => {
                verticalGoal.current = null;
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
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? listId : undefined}
              aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
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

/** Small screens start with ancillary context collapsed, leaving room to read and type. */
function ComposerDetails({ label, children }: { label: string; children: ReactNode }) {
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  return (
    <Collapsible open={!mobile || expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className={cn("min-h-11 w-full justify-start text-xs text-muted-foreground", !mobile && "hidden")}
          />
        }
      >
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** What settling a command fills into the box, with the trailing space its arguments would follow. */
function completion(command: PromptTemplateSummary): string {
  return `/${command.name} `;
}

/**
 * The command name being typed: the text after a leading `/`, while the message holds no argument and no further
 * slash. `null` once there is an argument, when the message is not a command, or when it is empty.
 */
function commandQuery(value: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(value);
  return match === null ? null : (match[1] ?? "");
}

/** A command's identity in the menu: its name, told apart from a global one of the same name. */
function commandValue(command: PromptTemplateSummary): string {
  return `${command.origin}/${command.name}`;
}
