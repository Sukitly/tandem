import type { ImageInput } from "@tandem/contracts";
import { ArrowUpIcon, ImagePlusIcon, SquareIcon, XIcon } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type AttachedImage, attachImages, IMAGE_ACCEPT, imageFiles } from "./attached-images.ts";
import type { QueuedMessage } from "./transcript.ts";

export interface ChatComposerProps {
  busy: boolean;
  queued: QueuedMessage[];
  /** Comments of the project waiting to be sent; they go with the message, which the server writes them into. */
  comments?: WaitingComment[];
  onWithdrawComment?(comment: WaitingComment): void;
  /** Rejects when the server refuses the message; the text and images then stay in the box, and the comments wait. */
  onSend: (text: string, comments: number[], images: ImageInput[], whenBusy: "steer" | "followUp") => Promise<void>;
  /**
   * Whether the current model takes images, and how many in a message. `false`: images are not offered, and pasting
   * one says why. Unknown (no model) offers them; the server decides.
   */
  images?: false | { maxPerMessage?: number };
  onStop: () => void;
  autoFocus?: boolean;
  /** Shown under the box: the model, the thinking level, and how full the context is. */
  status?: ReactNode;
}

/**
 * The message box. While the agent works, Enter steers it (the message is read at its next step) and Alt+Enter queues
 * a follow-up for when it is done, as in pi's terminal UI. Shift+Enter starts a new line.
 */
export function ChatComposer({
  busy,
  queued,
  comments = [],
  onWithdrawComment,
  onSend,
  onStop,
  autoFocus,
  status,
  images: accepts = {},
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [attached, setAttached] = useState<AttachedImage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const empty = value.trim() === "" && comments.length === 0 && attached.length === 0;

  // The thumbnails' URLs go with the box.
  const shown = useRef(attached);
  shown.current = attached;
  useEffect(
    () => () => {
      for (const image of shown.current) URL.revokeObjectURL(image.url);
    },
    [],
  );

  const attach = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    if (accepts === false) {
      setError("The current model does not take images. Choose one that does.");
      return;
    }
    const { attached: added, refused } = await attachImages(files, shown.current);
    const room = accepts.maxPerMessage === undefined ? added.length : accepts.maxPerMessage - shown.current.length;
    const kept = added.slice(0, Math.max(0, room));
    for (const image of added.slice(kept.length)) URL.revokeObjectURL(image.url);
    setAttached((current) => [...current, ...kept]);
    setError(
      refused ??
        (kept.length < added.length
          ? `The current model takes at most ${accepts.maxPerMessage} images in a message`
          : null),
    );
  };

  const detach = (id: number): void => {
    setAttached((current) =>
      current.filter((image) => {
        if (image.id === id) URL.revokeObjectURL(image.url);
        return image.id !== id;
      }),
    );
  };

  const send = async (whenBusy: "steer" | "followUp"): Promise<void> => {
    if (empty || sending) return;
    setSending(true);
    setError(null);
    const sent = attached;
    try {
      await onSend(
        value,
        comments.map((comment) => comment.messageId),
        sent.map((image) => image.input),
        whenBusy,
      );
      setValue("");
      setAttached((current) => current.filter((image) => !sent.includes(image)));
      for (const image of sent) URL.revokeObjectURL(image.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(event.altKey ? "followUp" : "steer");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send("steer");
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
    <div className="grid gap-2">
      <CommentList comments={comments} onWithdraw={(comment) => onWithdrawComment?.(comment)} />
      {queued.length > 0 && (
        <ItemGroup aria-label="Queued messages" className="gap-1">
          {queued.map((message) => (
            <Item key={message.id} size="xs" variant="muted">
              <Badge variant="outline">{message.mode === "steer" ? "Steering" : "Follow-up"}</Badge>
              <ItemContent>
                <ItemDescription className="truncate">{message.text}</ItemDescription>
              </ItemContent>
              {message.images > 0 && (
                <Badge variant="secondary">{message.images === 1 ? "1 image" : `${message.images} images`}</Badge>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
      <form
        onSubmit={onSubmit}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-label="Message box"
      >
        <InputGroup data-dragging={dragging || undefined} className="data-[dragging]:ring-2 data-[dragging]:ring-ring">
          {attached.length > 0 && (
            <InputGroupAddon align="block-start" className="flex-wrap gap-2">
              {attached.map((image) => (
                <div key={image.id} className="relative">
                  <img src={image.url} alt={image.name} className="size-14 rounded-md border object-cover" />
                  <InputGroupButton
                    type="button"
                    variant="secondary"
                    size="icon-xs"
                    className="absolute -top-1.5 -right-1.5"
                    aria-label={`Remove ${image.name}`}
                    onClick={() => detach(image.id)}
                  >
                    <XIcon />
                  </InputGroupButton>
                </div>
              ))}
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            className="max-h-60 min-h-0 py-2.5"
            aria-label="Message"
            placeholder={busy ? "Steer the agent, or Alt+Enter to queue a follow-up" : "Ask the agent"}
            autoFocus={autoFocus}
          />
          <InputGroupAddon align="inline-end" className="self-end pb-1.5">
            {accepts !== false && (
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
                      <InputGroupButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Attach images"
                        onClick={() => picker.current?.click()}
                      />
                    }
                  >
                    <ImagePlusIcon />
                  </TooltipTrigger>
                  <TooltipContent>Attach images, or paste or drop them</TooltipContent>
                </Tooltip>
              </>
            )}
            {busy && empty ? (
              <InputGroupButton type="button" variant="default" size="icon-sm" aria-label="Stop" onClick={onStop}>
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                aria-label="Send"
                disabled={empty || sending}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      {status}
      {error !== null && <FieldError>{error}</FieldError>}
    </div>
  );
}
