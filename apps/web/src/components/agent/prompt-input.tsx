import { cn } from "cn";
import {
  ArrowUpIcon,
  CornerDownLeftIcon,
  FileIcon,
  ListEndIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  Children,
  type ClipboardEvent,
  type ComponentProps,
  type CSSProperties,
  cloneElement,
  createContext,
  type DragEvent,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { AttachmentTile, type AttachmentTileProps } from "@/components/agent/attachment-tile";
import { ImageLightbox, type LightboxImage } from "@/components/agent/image-lightbox";
import { AttachmentAction, AttachmentGroup } from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

/** Which key sent the text. `alt` is Option+Enter on macOS. */
type SubmitKey = "enter" | "alt";

/**
 * What a send handler may return. A promise holds the text in the box until it
 * settles: it is cleared when the promise resolves, and kept when it rejects or
 * resolves `false`, so a message the server refuses is not lost.
 */
type SendResult = unknown;

/**
 * The keyboard of a touch screen has no Shift+Enter, so a screen whose main
 * pointer is coarse is taken for one, as the `pointer-coarse:` variant does.
 * Read at the key press, so it is not asked on the server.
 */
function isTouchScreen() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * Adds text to the end of what is already typed, after one blank line. An empty
 * box just takes it. The rule `usePromptInputActions().append` follows, for a
 * caller that keeps the text itself and sets it through `value`.
 */
function appendPromptText(current: string, added: string) {
  if (added === "") {
    return current;
  }

  const kept = current.replace(/\s+$/, "");

  return kept === "" ? added : `${kept}\n\n${added}`;
}

type PromptFileRules = {
  /**
   * The types allowed, written as the `accept` attribute of a file input is: a
   * type (`application/pdf`), a family (`image/*`) or an extension (`.csv`).
   * An extension is the way to tell a file by its name, since the same `.csv`
   * is reported with a different type on different machines.
   */
  accept?: string;
  /** The most a file may be, in bytes, or a function of the file for a limit that depends on its kind. */
  maxFileSize?: number | ((file: File) => number);
  /** The most files that may go with one message, those already attached included. */
  maxFiles?: number;
};

type PromptFileProblem = {
  /** `accept` is a type that is not allowed, `max_file_size` a file that is too big, and `max_files` the files over the count. */
  code: "accept" | "max_file_size" | "max_files";
  /** The files that were left out for it, so the message can name them. */
  files: File[];
};

/**
 * Splits the files that were added into those that may be attached and what was
 * left out, and why. The checks are yours, as the input only hands over the
 * files (`onAddFiles`), whether they were pasted, dropped or picked: this is the
 * usual one, for a handler to call. `attached` is how many files are on the
 * message already.
 *
 * A file is left out for the first rule it breaks, in the order of the rules
 * here: the type, then the size, then the count, which keeps the first ones.
 * Writing the message is yours, with the `files` of each problem.
 */
function checkPromptFiles(files: File[], { accept, maxFileSize, maxFiles }: PromptFileRules, attached = 0) {
  const problems: PromptFileProblem[] = [];
  const patterns = (accept ?? "")
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);

  function allowed(file: File) {
    return (
      patterns.length === 0 ||
      patterns.some((pattern) =>
        pattern.endsWith("/*")
          ? file.type.toLowerCase().startsWith(pattern.slice(0, -1))
          : pattern.startsWith(".")
            ? file.name.toLowerCase().endsWith(pattern)
            : file.type.toLowerCase() === pattern,
      )
    );
  }

  function small(file: File) {
    const limit = typeof maxFileSize === "function" ? maxFileSize(file) : maxFileSize;

    return limit === undefined || file.size <= limit;
  }

  function leaveOut(code: PromptFileProblem["code"], left: File[]) {
    if (left.length > 0) {
      problems.push({ code, files: left });
    }
  }

  const typed = files.filter(allowed);
  leaveOut(
    "accept",
    files.filter((file) => !typed.includes(file)),
  );

  const sized = typed.filter(small);
  leaveOut(
    "max_file_size",
    typed.filter((file) => !sized.includes(file)),
  );

  const room = maxFiles === undefined ? sized.length : Math.max(0, maxFiles - attached);
  leaveOut("max_files", sized.slice(room));

  return { accepted: sized.slice(0, room), problems };
}

type PromptInputContextValue = {
  text: string;
  setText: (text: string) => void;
  /** Adds text to the end after a blank line, then focuses the box with the caret at the end. */
  append: (text: string) => void;
  focus: () => void;
  /** A send is waiting on the caller's promise. */
  sending: boolean;
  /** Sends `sent` when it is given, in place of the text in the box. */
  submit: (key: SubmitKey, sent?: string) => void;
  stop?: () => void;
  /** There is something to send, and sending it now would reach a handler. */
  canSend: boolean;
  streaming: boolean;
  disabled: boolean;
  onAddFiles?: (files: File[]) => void;
  /** Files are being dragged over the input. */
  dragging: boolean;
  dropLabel: ReactNode;
  variant: "default" | "compact";
  enterSends: boolean | undefined;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Set by `PromptInputCommands` while it is in the box. */
  commands: CommandsBinding | null;
  setCommands: (binding: CommandsBinding | null) => void;
};

/**
 * What `PromptInputCommands` gives the textarea: a look at each key before the
 * box acts on it, and what a combobox says about itself to a screen reader.
 */
type CommandsBinding = {
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  open: boolean;
  listId: string;
  activeId: string | undefined;
  /**
   * The command at the start of the text that has been filled in, slash
   * included, to be drawn as a chip. Empty when there is none.
   */
  chip: string;
};

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInput() {
  const context = useContext(PromptInputContext);

  if (!context) {
    throw new Error("Prompt input parts must be used inside <PromptInput>");
  }

  return context;
}

/**
 * What the parts inside a `PromptInput` can do to its text: `append` adds text
 * after a blank line and focuses the box, `focus` focuses it. For a caller that
 * keeps the text itself, `appendPromptText` follows the same rule.
 */
function usePromptInputActions() {
  const { append, focus } = usePromptInput();

  return { append, focus };
}

type PromptInputProps = {
  children: ReactNode;
  /**
   * Called with the trimmed text when the person sends and no reply is
   * streaming. Return a promise if the send is the server's to accept: the text
   * stays in the box, read-only, until it resolves, and is kept if it rejects or
   * resolves `false`. Show the error yourself.
   */
  onSubmit: (text: string) => SendResult;
  /**
   * Called with the trimmed text when the person sends with Enter while a reply
   * streams, to steer that reply. Leave both this and `onFollowUp` out and
   * nothing can be sent until the reply finishes.
   */
  onSteer?: (text: string) => SendResult;
  /**
   * Called with the trimmed text when the person sends with Option+Enter while a
   * reply streams, to queue it for after the reply. Enter uses it too when there
   * is no `onSteer`.
   */
  onFollowUp?: (text: string) => SendResult;
  /** Controlled text. Pair with `onValueChange`. Leave out to let the input keep its own. */
  value?: string;
  /** Text before the person types, when the input keeps its own. */
  defaultValue?: string;
  /** Called as the text changes, and with `""` after a send clears it. */
  onValueChange?: (value: string) => void;
  /** A reply is arriving. The send button becomes a stop button while the box is empty. */
  streaming?: boolean;
  /** Called when the stop button or Escape is pressed while a reply streams. */
  onStop?: () => void;
  /**
   * Something besides the text goes with the message, such as attachments or a
   * quote, so it can be sent with no text. Keeping track of those is yours.
   */
  allowEmpty?: boolean;
  /**
   * Called with the files the person pastes, drops on the input, or picks with
   * `PromptInputAttachButton`. Storing, uploading and checking them is yours.
   * Leave it out and pasting and dropping files is left to the browser.
   */
  onAddFiles?: (files: File[]) => void;
  /** Shown over the box while files are dragged onto it. */
  dropLabel?: ReactNode;
  /**
   * `compact` is one row: the text on a line that does not wrap or grow, and the
   * toolbar at the end of the same row. The buttons are the size of the
   * default's: a row is a layout, not a smaller input. For a place with room
   * for a line and no more, such as a comment on a passage. Enter,
   * Escape and input methods are as they are, and Shift+Enter still breaks the
   * line. Use it with the textarea and the toolbar only: a queue, a quote,
   * attachments and a footer need the room of the default.
   */
  variant?: "default" | "compact";
  /**
   * Whether Enter sends. Left out, it does everywhere but on a touch screen,
   * whose keyboard has no Shift+Enter, so there Enter breaks the line and the
   * send button sends. A `compact` row has no room for a second line, so Enter
   * sends there on a touch screen too. Pass `true` or `false` to have it the
   * same everywhere. Where Enter breaks the line, Ctrl+Enter or Cmd+Enter
   * sends, for a touch screen with a keyboard.
   */
  enterSends?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * The field the person types into, with an optional queue above the box and
 * footer below it. It owns the parts that are easy to get wrong: Enter sends and
 * Shift+Enter breaks the line (on a touch screen Enter breaks the line and the
 * button sends, see `enterSends`), an Enter that picks an input method candidate
 * does not send, blank text cannot be sent unless `allowEmpty` says something
 * else goes with it, files that are pasted or dropped go to `onAddFiles`, and
 * while a reply streams the text goes to `onSteer` or `onFollowUp` and Escape
 * stops the reply.
 *
 * It sits in the same centred column as `MessageList`, so the two line up.
 */
function PromptInput({
  children,
  onSubmit,
  onSteer,
  onFollowUp,
  value,
  defaultValue = "",
  onValueChange,
  streaming = false,
  onStop,
  allowEmpty = false,
  onAddFiles,
  dropLabel = "Drop files to attach",
  variant = "default",
  enterSends,
  disabled = false,
  className,
}: PromptInputProps) {
  const [ownText, setOwnText] = useState(defaultValue);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandsBinding | null>(null);
  // Moving over a child fires a leave for the parent and an enter for the child,
  // so a drag is over the input while enters outnumber leaves.
  const dragDepth = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isControlled = value !== undefined;
  const text = isControlled ? value : ownText;
  const canQueue = onSteer !== undefined || onFollowUp !== undefined;
  // The text as it is now, for an append that follows another before the box
  // has rendered.
  const latestText = useRef(text);
  latestText.current = text;
  const canSend = !disabled && !sending && (text.trim() !== "" || allowEmpty) && (!streaming || canQueue);
  const takesDrops = onAddFiles !== undefined && !disabled;

  function isFileDrag(event: DragEvent<HTMLElement>) {
    return takesDrops && event.dataTransfer.types.includes("Files");
  }

  function setText(next: string) {
    latestText.current = next;

    if (!isControlled) {
      setOwnText(next);
    }
    onValueChange?.(next);
  }

  function focus() {
    textareaRef.current?.focus();
  }

  function append(added: string) {
    setText(appendPromptText(latestText.current, added));

    // After the new text has rendered, so the caret can go to its end.
    requestAnimationFrame(() => {
      const element = textareaRef.current;

      if (element) {
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      }
    });
  }

  function submit(key: SubmitKey, sent: string = text) {
    if (!canSend) {
      return;
    }

    const send = streaming ? (key === "alt" ? onFollowUp : (onSteer ?? onFollowUp)) : onSubmit;

    if (!send) {
      return;
    }

    const result = send(sent.trim());

    // A promise holds the text until the caller says whether the send was
    // taken. Cleared through `setText`, so a controlled input is asked to clear
    // too.
    if (isPromiseLike(result)) {
      setSending(true);
      result.then(
        (outcome) => {
          setSending(false);

          if (outcome !== false) {
            setText("");
          }
        },
        () => setSending(false),
      );

      return;
    }

    if (result !== false) {
      setText("");
    }
  }

  return (
    <PromptInputContext.Provider
      value={{
        text,
        setText,
        append,
        focus,
        sending,
        submit,
        stop: onStop,
        canSend,
        streaming,
        disabled,
        onAddFiles,
        dragging,
        dropLabel,
        variant,
        enterSends,
        textareaRef,
        commands,
        setCommands,
      }}
    >
      <form
        data-slot="prompt-input"
        // The same column as `MessageList`, padding included, so the box lines
        // up with the text above it.
        className={cn(
          "max-w-3xl px-4 [&>[data-slot=prompt-input-queue]+[data-slot=prompt-input-box]]:rounded-t-none mx-auto flex w-full flex-col",
          className,
        )}
        onSubmit={(event) => {
          event.preventDefault();
          submit("enter");
        }}
        onDragEnter={(event) => {
          if (!isFileDrag(event)) {
            return;
          }

          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!isFileDrag(event)) {
            return;
          }

          // Without this the browser refuses the drop.
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!isFileDrag(event)) {
            return;
          }

          dragDepth.current = Math.max(0, dragDepth.current - 1);

          if (dragDepth.current === 0) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          if (!isFileDrag(event)) {
            return;
          }

          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          onAddFiles?.([...event.dataTransfer.files]);
        }}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

/**
 * An addon only focuses an `input` when clicked, and this field is a textarea,
 * so the box's rows focus it themselves. A click on a button inside is left to
 * the button. So is a click in a menu or popover opened from the row: it is
 * drawn elsewhere in the page, but React still passes its clicks up through the
 * row, and focusing the textarea would pull focus out of it.
 */
function focusTextarea(event: MouseEvent<HTMLElement>, textareaRef: RefObject<HTMLTextAreaElement | null>) {
  const target = event.target as HTMLElement;

  if (!event.currentTarget.contains(target) || target.closest("button")) {
    return;
  }

  textareaRef.current?.focus();
}

const QUEUE_KINDS = {
  // Both arrows are the Enter arrow, since both are sent with Enter. Follow-up
  // adds the list, as it waits its turn.
  steering: { label: "Steering", icon: <CornerDownLeftIcon /> },
  "follow-up": { label: "Follow-up", icon: <ListEndIcon /> },
} as const;

/** How long a row takes to leave, and the tray to close around it. */
const QUEUE_EXIT_MS = 200;

type QueueRow = { key: string; element: ReactElement; exiting: boolean };

/**
 * The rows to draw: the ones given, plus any that were just removed, kept for
 * `QUEUE_EXIT_MS` and marked as exiting so they can fade out in place. A row
 * that is gone from the children has already been unmounted by the time an
 * effect could notice, so the ones leaving are worked out while rendering, from
 * the rows of the last commit.
 */
function useQueueRows(children: ReactNode): QueueRow[] {
  const current = Children.toArray(children).filter(isValidElement);
  const committed = useRef<ReactElement[]>(current);
  const leaving = useRef(new Map<string, { element: ReactElement; index: number }>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, refresh] = useReducer((tick: number) => tick + 1, 0);
  const keys = new Set(current.map((element) => String(element.key)));

  committed.current.forEach((element, index) => {
    const key = String(element.key);

    // Only the queue's own rows can fade, as they take the `exiting` prop.
    if (element.type === PromptInputQueueItem && !keys.has(key) && !leaving.current.has(key)) {
      leaving.current.set(key, { element, index });
    }
  });

  for (const key of keys) {
    leaving.current.delete(key);
  }

  useEffect(() => {
    committed.current = current;

    for (const key of leaving.current.keys()) {
      if (!timers.current.has(key)) {
        timers.current.set(
          key,
          setTimeout(() => {
            leaving.current.delete(key);
            timers.current.delete(key);
            refresh();
          }, QUEUE_EXIT_MS),
        );
      }
    }
  });

  useEffect(() => {
    const pending = timers.current;

    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  const rows: QueueRow[] = current.map((element) => ({
    key: String(element.key),
    element,
    exiting: false,
  }));

  const leavingRows = [...leaving.current.entries()].sort((a, b) => a[1].index - b[1].index);

  for (const [key, { element, index }] of leavingRows) {
    rows.splice(Math.min(index, rows.length), 0, {
      key,
      element,
      exiting: true,
    });
  }

  return rows;
}

type PromptInputQueueProps = {
  /** `PromptInputQueueItem` rows, oldest first. */
  children: ReactNode;
  /** Rows shown before the queue scrolls. */
  maxRows?: number;
  /** Names the queue for screen readers. Defaults to "Queued messages". */
  label?: string;
  className?: string;
};

/**
 * Messages sent while a reply streams, waiting to be taken up. They are already
 * sent, so they sit outside the box, but joined to its top edge so the two read
 * as one card. The newest row sits against the box and the queue grows upward,
 * which keeps the box where it is. Past `maxRows` it scrolls, stopped at the
 * newest row. It takes no space when it is empty.
 *
 * It opens as the first row arrives, grows and shrinks as rows come and go, and
 * closes as the last leaves, and a row slides up from the box as it arrives and
 * fades out as it leaves. None of it moves with reduced motion. The tray's
 * height is worked out from the rows being 1.75rem tall, so that it can change
 * smoothly.
 */
function PromptInputQueue({ children, maxRows = 3, label = "Queued messages", className }: PromptInputQueueProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useQueueRows(children);
  const settled = rows.filter((row) => !row.exiting).length;

  // Keep the newest row in view as the queue changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row count is the trigger
  useLayoutEffect(() => {
    const element = scrollRef.current;

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [settled]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section
      data-slot="prompt-input-queue"
      aria-label={label}
      // The height is the rows, the padding and the top border, which are sizes
      // in the style file, and `starting:` is where it opens from.
      style={
        {
          "--queue-height": settled === 0 ? "0px" : `calc(${Math.min(settled, maxRows) * 1.75 + 0.5}rem + 1px)`,
        } as CSSProperties
      }
      // Every row is on its way out, so the tray fades with them.
      data-closing={settled === 0 || undefined}
      className={cn(
        "rounded-t-xl border border-b-0 bg-muted/50 starting:opacity-0 data-[closing=true]:opacity-0 h-(--queue-height) overflow-hidden transition-[height,opacity] duration-200 starting:h-0 motion-reduce:transition-none",
        className,
      )}
    >
      <div className="py-1">
        <div
          ref={scrollRef}
          // A row is 1.75rem tall. The rows share three columns, for the badge,
          // the text and the actions, so the text of every row starts at the
          // same place however wide its badge is.
          style={{ maxHeight: `${maxRows * 1.75}rem` }}
          className="gap-x-2 scroll-fade-y scrollbar-thin grid grid-cols-[auto_minmax(0,1fr)_auto] overflow-y-auto overscroll-contain"
        >
          {rows.map((row) =>
            row.exiting
              ? cloneElement(row.element as ReactElement<{ exiting?: boolean }>, {
                  exiting: true,
                })
              : row.element,
          )}
        </div>
      </div>
    </section>
  );
}

/** A file on a queued message, for the popover that opens from its count. */
type PromptInputQueueFile = {
  id: string | number;
  name: string;
  /** An image address. Without one the file shows as its name. */
  src?: string;
};

type PromptInputQueueItemProps = {
  children: ReactNode;
  /** A built-in type: sets the icon and the name shown in the badge. */
  kind?: keyof typeof QUEUE_KINDS;
  /** The badge's icon. Overrides `kind`'s, or marks a type of your own. */
  icon?: ReactNode;
  /** The badge's name. Overrides `kind`'s, or names a type of your own. */
  label?: ReactNode;
  /**
   * The files the message carries, shown at the end as a paperclip and a count.
   * Pass the files and a click opens them in a popover, images at a size you can
   * read; pass only a number to show the count.
   */
  attachments?: number | PromptInputQueueFile[];
  /** Names the count for screen readers and the tooltip. Defaults to "2 attachments". */
  attachmentsLabel?: string;
  /** Controls at the end, always visible, before the take back and remove buttons. Give buttons `type="button"`. */
  actions?: ReactNode;
  /**
   * `sending` is a message the server has not confirmed: its text shimmers and
   * it cannot be taken back or removed yet. `error` is one the server refused:
   * the row turns red.
   */
  state?: "sending" | "error";
  /**
   * Adds a take back button, shown on hover. Pulling the message back is the
   * server's to allow, so this may return a promise: the button waits, and when
   * it resolves, anything but `false`, the message's text goes back into the
   * input after a blank line. When it rejects or resolves `false`, such as when
   * the message was already taken up, nothing is put back. Show the error
   * yourself. Moving the message's files back is yours.
   */
  onTakeBack?: () => unknown;
  /** The text that goes back into the input. Defaults to the row's text when that is a string. */
  text?: string;
  /** Names the take back button for screen readers and the tooltip. */
  takeBackLabel?: string;
  /**
   * Adds a remove button, shown on hover, that drops the message without
   * putting it back. May return a promise, and the button waits for it.
   */
  onRemove?: () => unknown;
  /** Names the remove button for screen readers. */
  removeLabel?: string;
  /** Set by the queue while the row fades out after it was removed. Not for you to set. */
  exiting?: boolean;
  className?: string;
};

/**
 * One queued message: a badge naming its type, then the text on one line. A
 * type of your own is an `icon` and a `label` with no `kind`. A row with
 * neither has no badge. `attachments` shows the files that went with it, and a
 * click opens them; moving the files from the input to the queue is yours.
 */
function PromptInputQueueItem({
  children,
  kind,
  icon,
  label,
  attachments,
  attachmentsLabel,
  actions,
  state,
  onTakeBack,
  text,
  takeBackLabel = "Take back",
  onRemove,
  removeLabel = "Remove",
  exiting = false,
  className,
}: PromptInputQueueItemProps) {
  const { append } = usePromptInput();
  const [busy, setBusy] = useState<"takeBack" | "remove" | null>(null);
  const takeBackText = text ?? (typeof children === "string" ? children : "");

  async function run(action: "takeBack" | "remove", handler: () => unknown) {
    setBusy(action);

    try {
      const outcome = await handler();

      if (action === "takeBack" && outcome !== false && takeBackText) {
        append(takeBackText);
      }
    } catch {
      // The caller shows its own error. Nothing is put back.
    } finally {
      setBusy(null);
    }
  }

  const locked = busy !== null || state === "sending";

  const name = label ?? (kind ? QUEUE_KINDS[kind].label : undefined);
  const shownIcon = icon ?? (kind ? QUEUE_KINDS[kind].icon : undefined);
  const [filesOpen, setFilesOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const files = Array.isArray(attachments) ? attachments : undefined;
  const pictures = (files ?? []).flatMap((file) => (file.src ? [{ id: file.id, src: file.src, name: file.name }] : []));
  const count = Array.isArray(attachments) ? attachments.length : (attachments ?? 0);
  const countLabel = attachmentsLabel ?? `${count} ${count === 1 ? "attachment" : "attachments"}`;

  return (
    <div
      data-slot="prompt-input-queue-item"
      data-kind={kind}
      data-state={state}
      data-exiting={exiting || undefined}
      aria-hidden={exiting || undefined}
      // Spans the queue's three columns and shares them, and starts 16px in from
      // the left, where the text in the box starts.
      className={cn(
        // A new row slides up from the box, and one that leaves fades back
        // toward it. `starting:` is the state a row mounts in.
        "h-7 pr-2 pl-4 text-muted-foreground text-sm starting:opacity-0 hover:bg-muted hover:text-foreground data-[state=error]:text-destructive data-[state=error]:hover:text-destructive data-[exiting=true]:opacity-0 group/queue-item col-span-3 grid min-w-0 grid-cols-subgrid items-center transition-[color,background-color,opacity,translate] duration-200 starting:translate-y-2 motion-reduce:transition-none",
        exiting && "pointer-events-none translate-y-2",
        className,
      )}
    >
      {(shownIcon || name) && (
        <Badge variant="outline" className="text-muted-foreground col-start-1">
          {shownIcon}
          {name}
        </Badge>
      )}
      <span className={cn("col-start-2 min-w-0 truncate", state === "sending" && "shimmer motion-reduce:shimmer-none")}>
        {children}
      </span>
      {/* The column is as wide as the widest row's controls, so each row's sit
          against its right edge, which keeps the buttons in line. */}
      <div className="gap-1.5 col-start-3 flex items-center justify-end">
        {count > 0 &&
          (files ? (
            <Popover open={filesOpen} onOpenChange={setFilesOpen}>
              <PopoverTrigger
                render={<button type="button" />}
                title={countLabel}
                aria-label={countLabel}
                className="h-6 gap-0.5 rounded-md px-1.5 text-xs hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50 flex items-center tabular-nums outline-none transition-colors"
              >
                <PaperclipIcon className="size-3.5" />
                {count}
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="max-h-[60dvh] w-auto max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto"
              >
                <div className="gap-2 flex flex-wrap">
                  {files.map((file) =>
                    file.src ? (
                      <button
                        key={file.id}
                        type="button"
                        title={file.name}
                        // The popover closes first, so two layers are not
                        // open at once.
                        onClick={() => {
                          setFilesOpen(false);
                          setViewing(pictures.findIndex((other) => other.id === file.id));
                        }}
                        className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 cursor-zoom-in outline-none"
                      >
                        <img
                          src={file.src}
                          alt={file.name}
                          className="max-h-64 rounded-lg border w-auto max-w-full object-contain"
                        />
                      </button>
                    ) : (
                      <div
                        key={file.id}
                        className="gap-2 rounded-lg border px-3 py-2 flex min-w-0 max-w-full items-center"
                      >
                        <FileIcon className="size-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </div>
                    ),
                  )}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span title={countLabel} className="gap-0.5 px-1.5 text-xs flex items-center tabular-nums">
              <PaperclipIcon className="size-3.5" />
              {count}
              <span className="sr-only">{countLabel}</span>
            </span>
          ))}
        <ImageLightbox images={pictures} index={viewing} onIndexChange={setViewing} />
        {actions}
        {onTakeBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={takeBackLabel}
            title={takeBackLabel}
            disabled={locked}
            onClick={() => run("takeBack", onTakeBack)}
            // Shown while it waits, whatever the row is doing.
            data-busy={busy === "takeBack" || undefined}
            className="opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/queue-item:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-foreground/15 [&:where([data-busy=true])]:opacity-100"
          >
            {busy === "takeBack" ? <Spinner className="motion-reduce:animate-none" /> : <Undo2Icon />}
          </Button>
        )}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={removeLabel}
            title={removeLabel}
            disabled={locked}
            onClick={() => run("remove", onRemove)}
            // Shown while it waits, whatever the row is doing.
            data-busy={busy === "remove" || undefined}
            className="opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover/queue-item:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-destructive/20 [&:where([data-busy=true])]:opacity-100"
          >
            {busy === "remove" ? <Spinner className="motion-reduce:animate-none" /> : <XIcon />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The bordered box that holds the text and the toolbar. */
function PromptInputBox({ className, children, ...props }: ComponentProps<typeof InputGroup>) {
  const { disabled, dragging, dropLabel } = usePromptInput();

  return (
    <InputGroup
      data-slot="prompt-input-box"
      // Whether the textarea itself is disabled, which is not the same as
      // anything in the group being so, such as the send button when the text
      // is blank. Not `data-disabled`, which the group's addons grey out for.
      data-textarea-disabled={disabled || undefined}
      className={cn(
        "border-border bg-background shadow-[0_4px_24px_0] shadow-foreground/8 rounded-xl dark:shadow-none has-[[data-slot=input-group-control]:focus-visible]:not-has-[[aria-invalid=true]]:border-border has-[[data-slot=input-group-control]:focus-visible]:ring-0 not-data-textarea-disabled:has-disabled:bg-background not-data-textarea-disabled:has-disabled:opacity-100 dark:not-data-textarea-disabled:has-disabled:bg-input/30",
        className,
      )}
      {...props}
    >
      {children}
      {dragging && (
        // Where a dropped file would land: a layer of its own over the box,
        // which keeps the box's look and takes no pointer events.
        <div
          aria-hidden
          className="border-2 border-ring border-dashed bg-background/80 text-muted-foreground text-sm pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit]"
        >
          {dropLabel}
        </div>
      )}
    </InputGroup>
  );
}

type PromptInputQuoteProps = {
  /** The quoted text. It keeps to one line. */
  children: ReactNode;
  /** Adds a remove button, for sending without the quote. */
  onRemove?: () => void;
  /** Names the remove button for screen readers. */
  removeLabel?: string;
  className?: string;
};

/**
 * A quote the next message replies to, inside the box above the text. It goes
 * out with the message, so it belongs in the box rather than above it.
 */
function PromptInputQuote({ children, onRemove, removeLabel = "Remove quote", className }: PromptInputQuoteProps) {
  const { textareaRef } = usePromptInput();

  return (
    <InputGroupAddon
      align="block-start"
      data-slot="prompt-input-quote"
      onClick={(event) => focusTextarea(event, textareaRef)}
      className={cn("gap-1 px-4 pt-3 pb-0", className)}
    >
      <blockquote className="border-l-2 pl-2 font-normal text-muted-foreground flex min-w-0 flex-1 items-center">
        <span className="truncate">{children}</span>
      </blockquote>
      {onRemove && (
        <InputGroupButton size="icon-xs" aria-label={removeLabel} onClick={onRemove} className="-mr-1.5">
          <XIcon />
        </InputGroupButton>
      )}
    </InputGroupAddon>
  );
}

/** Lets a tile open the picture it shows, among the pictures of its row. */
const AttachmentViewerContext = createContext<{
  open: (image: LightboxImage) => void;
} | null>(null);

/**
 * Files that go with the next message, inside the box above the text. One row
 * of tiles that scrolls sideways, so the box does not grow however many there
 * are. It takes no space when it is empty. Its `aria-label` names the row for
 * screen readers, "Attachments" unless you pass your own.
 */
function PromptInputAttachments({ className, children, ...props }: ComponentProps<typeof AttachmentGroup>) {
  const { textareaRef } = usePromptInput();
  const [viewer, setViewer] = useState<{
    images: LightboxImage[];
    index: number;
  } | null>(null);
  const tiles = Children.toArray(children);

  if (tiles.length === 0) {
    return null;
  }

  // The pictures of the row, read from the tiles, so the lightbox can step
  // through them. A tile wrapped in a component of your own is not seen here,
  // and opens alone.
  const images = tiles.flatMap((tile) =>
    isValidElement<PromptInputAttachmentProps>(tile) && tile.type === PromptInputAttachment && tile.props.src
      ? [{ src: tile.props.src, name: tile.props.name }]
      : [],
  );

  function open(image: LightboxImage) {
    const index = images.findIndex((other) => other.src === image.src);

    setViewer(index === -1 ? { images: [image], index: 0 } : { images, index });
  }

  return (
    <AttachmentViewerContext.Provider value={{ open }}>
      <InputGroupAddon
        align="block-start"
        data-slot="prompt-input-attachments"
        onClick={(event) => focusTextarea(event, textareaRef)}
        className="px-4 pt-3 pb-0"
      >
        <AttachmentGroup
          role="list"
          aria-label="Attachments"
          className={cn("gap-2 py-0 w-full items-center", className)}
          {...props}
        >
          {children}
        </AttachmentGroup>
      </InputGroupAddon>
      <ImageLightbox
        images={viewer?.images ?? []}
        index={viewer?.index ?? null}
        onIndexChange={(index) => setViewer((current) => (current && index !== null ? { ...current, index } : null))}
      />
    </AttachmentViewerContext.Provider>
  );
}

type PromptInputAttachmentProps = Omit<AttachmentTileProps, "actions" | "onView" | "viewLabel"> & {
  /** Adds a remove button in the corner, shown on hover and always on touch screens. */
  onRemove?: () => void;
  /** Names the remove button for screen readers. Defaults to "Remove" and the name. */
  removeLabel?: string;
};

/**
 * One file as an `AttachmentTile`, a 96px square. A remove button sits in the
 * corner. A picture is cropped to fill the square, and opens whole in a lightbox
 * on a click, with the other pictures of the row a key away.
 */
function PromptInputAttachment({ onRemove, removeLabel, ...props }: PromptInputAttachmentProps) {
  const viewer = useContext(AttachmentViewerContext);
  const { name, src } = props;

  return (
    <AttachmentTile
      role="listitem"
      {...props}
      onView={src && viewer ? () => viewer.open({ src, name }) : undefined}
      actions={
        onRemove && (
          <AttachmentAction
            type="button"
            variant="secondary"
            aria-label={removeLabel ?? `Remove ${name}`}
            onClick={onRemove}
            className="opacity-0 focus-visible:opacity-100 group-hover/attachment:opacity-100 pointer-coarse:opacity-100"
          >
            <XIcon />
          </AttachmentAction>
        )
      }
    />
  );
}

// What the textarea sets its text with. A layer that has the same values and
// the same size, in the same place, breaks its lines at the same words.
const MIRRORED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontStretch",
  "fontFeatureSettings",
  "fontVariationSettings",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "textAlign",
  "tabSize",
  "direction",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

/**
 * Puts the layer over the textarea's content area, its text set the way the
 * textarea sets its own, and scrolled as far as it is. Read from the textarea,
 * not written down, so it follows the style, the variant and any class given.
 */
function alignChipLayer(layer: HTMLElement, area: HTMLTextAreaElement) {
  const computed = getComputedStyle(area);

  for (const name of MIRRORED_STYLES) {
    layer.style[name] = computed[name];
  }

  // The layer and the textarea have the same parent, the box, which is the one
  // they are placed in.
  layer.style.top = `${area.offsetTop + area.clientTop}px`;
  layer.style.left = `${area.offsetLeft + area.clientLeft}px`;
  layer.style.width = `${area.clientWidth}px`;
  layer.style.height = `${area.clientHeight}px`;
  layer.scrollTop = area.scrollTop;
  layer.scrollLeft = area.scrollLeft;
}

/**
 * Keeps the chip layer where the textarea is, while there is one. In the
 * textarea's own component and not the layer's, whose effects run before the
 * textarea's ref is set again after a render, when it is still empty.
 */
function useChipLayer(active: boolean, textareaRef: RefObject<HTMLTextAreaElement | null>) {
  const layerRef = useRef<HTMLDivElement>(null);

  // After every render: the text, and so the height, may be new.
  useLayoutEffect(() => {
    if (active && layerRef.current && textareaRef.current) {
      alignChipLayer(layerRef.current, textareaRef.current);
    }
  });

  // The textarea scrolls when its text is longer than it may grow, and changes
  // size when the window does, without a render of ours.
  useEffect(() => {
    const area = textareaRef.current;

    if (!(active && area)) {
      return;
    }

    const follow = () => {
      if (layerRef.current) {
        alignChipLayer(layerRef.current, area);
      }
    };
    const observer = new ResizeObserver(follow);

    area.addEventListener("scroll", follow);
    observer.observe(area);

    return () => {
      area.removeEventListener("scroll", follow);
      observer.disconnect();
    };
  }, [active, textareaRef]);

  return layerRef;
}

/**
 * The text again, behind the textarea, with the command at its start set apart
 * as a chip. The text the person sees is this one while a command is there, and
 * what they type into, select and move the caret in is the textarea on top of
 * it, which has no colour of its own then. Hidden from screen readers, which
 * read the textarea, and left out when the system sets its own colours.
 */
function PromptInputChipLayer({
  text,
  chip,
  ref,
}: {
  text: string;
  chip: string;
  ref: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-slot="prompt-input-chip-layer"
      className="pointer-events-none absolute z-0 overflow-hidden select-none forced-colors:hidden"
    >
      <span className="-ml-1 -mr-0.5 rounded-sm bg-foreground/10 py-0.5 pr-0.5 pl-1">{text.slice(0, chip.length)}</span>
      {text.slice(chip.length)}
    </div>
  );
}

type PromptInputTextareaProps = Omit<ComponentProps<typeof InputGroupTextarea>, "value" | "defaultValue" | "onChange">;

/** The text, on the first row of the box. One line tall until it grows. */
function PromptInputTextarea({ className, onKeyDown, onPaste, ref, ...props }: PromptInputTextareaProps) {
  const {
    text,
    setText,
    submit,
    stop,
    streaming,
    disabled,
    sending,
    onAddFiles,
    variant,
    enterSends,
    textareaRef,
    commands,
  } = usePromptInput();

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    onPaste?.(event);

    if (event.defaultPrevented || !onAddFiles || disabled) {
      return;
    }

    // Files on the clipboard are attached, and a paste that has none goes into
    // the box as usual. A copy that holds both, such as spreadsheet cells, is
    // attached and its text is not pasted.
    const files = [...event.clipboardData.files];

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    onAddFiles(files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);

    if (event.defaultPrevented) {
      return;
    }

    // A key that belongs to an input method, picking a candidate or cancelling
    // one, must not send or stop. Safari fires that keydown after composition
    // has ended, so `isComposing` is already false there, but it still reports
    // key code 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }

    // The commands menu, when there is one, takes its keys here: after an input
    // method has had its own, and before Escape stops a reply or Enter sends.
    commands?.onKeyDown(event);

    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Escape" && streaming && stop) {
      event.preventDefault();
      stop();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    // Where Enter breaks the line, the browser does it, and Ctrl or Cmd with
    // Enter sends.
    const sendsOnEnter = enterSends ?? (variant === "compact" || !isTouchScreen());

    if (!sendsOnEnter && !event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    submit(event.altKey ? "alt" : "enter");
  }

  // The command at the start is drawn as a chip: the textarea cannot style a
  // part of its text, so a layer behind it holds the same text, with the command
  // set apart, and the textarea's own text is made see-through. Only while there
  // is one, so every other state is the textarea as it is.
  const chip = commands?.chip ?? "";
  const showChip = chip !== "" && text.startsWith(chip) && /^\s/.test(text.slice(chip.length));
  const chipLayerRef = useChipLayer(showChip, textareaRef);

  return (
    <>
      {showChip && <PromptInputChipLayer ref={chipLayerRef} text={text} chip={chip} />}
      <InputGroupTextarea
        rows={1}
        // One row does not wrap: a line that is too long scrolls sideways.
        wrap={variant === "compact" ? "off" : undefined}
        {...(commands && {
          role: "combobox",
          "aria-haspopup": "listbox",
          "aria-autocomplete": "list",
          "aria-expanded": commands.open,
          "aria-controls": commands.open ? commands.listId : undefined,
          "aria-activedescendant": commands.activeId,
        })}
        {...props}
        ref={(node) => {
          textareaRef.current = node;

          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        value={text}
        disabled={disabled}
        // While a send waits on the server the text is the one being sent, so it
        // is not edited.
        readOnly={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        // One line tall when empty, so the toolbar sits right under the text
        // instead of below a block of empty space. It grows with its text, then
        // scrolls instead of pushing the page down.
        data-variant={variant}
        data-chip={showChip || undefined}
        className={cn(
          // A compact row is the height of the box, and what does not fit in it is
          // cut, a second line included. Over the chip layer, which is behind it.
          "max-h-48 p-4 placeholder:text-muted-foreground data-[variant=compact]:py-3.75 data-[variant=compact]:leading-5 data-[chip=true]:text-transparent data-[chip=true]:caret-foreground forced-colors:data-[chip=true]:text-[color:CanvasText] min-h-0 data-[chip=true]:relative data-[chip=true]:z-1 data-[variant=compact]:h-full data-[variant=compact]:max-h-full data-[variant=compact]:overflow-hidden data-[variant=compact]:whitespace-nowrap",
          className,
        )}
      />
    </>
  );
}

type PromptCommand = {
  /**
   * The name without its slash: what is filled into the box, and what the typed
   * letters are matched against, from the start of it and in any case.
   */
  name: string;
  /** After the name, in grey, cut to one line. */
  description?: ReactNode;
  /** At the end of the row, such as where the command comes from. */
  badge?: ReactNode;
  /** Tells apart commands of one name, such as a project's and a global one. */
  id?: string;
};

type PromptInputCommandsProps = {
  commands: readonly PromptCommand[];
  /** The heading while only the slash is typed. */
  label?: ReactNode;
  /** The heading while letters follow the slash. */
  queryLabel?: (query: string) => ReactNode;
  /**
   * Draw a command that has been filled in at the start of the message as a
   * chip, so it can be told from what follows. Only a name that is in
   * `commands` is, in the case it is written in. Turn it off to leave the text
   * as plain as it is typed.
   */
  chip?: boolean;
  className?: string;
};

// The whole message is a slash and the start of a name: no space yet, so no
// argument has been typed.
const COMMAND_TEXT = /^\/([^\s/]*)$/;

/**
 * The commands a message may begin with, offered above the box while it holds a
 * slash and no space. Put it in `PromptInputBox`, next to `PromptInputTextarea`.
 *
 * Focus stays in the textarea, so typing, Shift+Enter and an input method keep
 * working, and the menu takes only its own keys: Up and Down, or Ctrl+N and
 * Ctrl+P, move, Tab fills the command in so its arguments can be typed, Enter
 * fills it in and sends it, Escape or Shift+Tab puts the menu away (Escape
 * stops a reply only when no menu is open), and a click fills a row in. The
 * textarea is a combobox for a screen reader, and the menu is its listbox. It
 * does not open while a send waits on the server or the box is disabled.
 */
function PromptInputCommands({
  commands,
  label = "Commands",
  queryLabel = (query) => `Commands matching /${query}`,
  chip = true,
  className,
}: PromptInputCommandsProps) {
  const { text, setText, submit, focus, sending, disabled, setCommands } = usePromptInput();
  const listId = useId();
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Where in the list the person is, and whether they put it away. Both are
  // about this text: when it changes they start over, and the menu comes back.
  const [nav, setNav] = useState({ text, index: 0, dismissed: false });

  if (nav.text !== text) {
    setNav({ text, index: 0, dismissed: false });
  }

  const current = nav.text === text ? nav : { text, index: 0, dismissed: false };
  const query = COMMAND_TEXT.exec(text)?.[1] ?? null;
  const matching =
    query === null ? [] : commands.filter((command) => command.name.toLowerCase().startsWith(query.toLowerCase()));
  const open = query !== null && matching.length > 0 && !current.dismissed && !sending && !disabled;
  const selected = open ? Math.min(current.index, matching.length - 1) : -1;
  const optionId = (index: number) => `${listId}-${index}`;
  const activeId = selected >= 0 ? optionId(selected) : undefined;
  // A command that is known and has a space after it: filled in, or typed out.
  const filled = chip ? /^\/([^\s/]+)(?=\s)/.exec(text)?.[1] : undefined;
  const chipText = filled !== undefined && commands.some((command) => command.name === filled) ? `/${filled}` : "";

  function fill(command: PromptCommand) {
    setText(`/${command.name} `);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const command = matching[selected];

    if (!open || !command) {
      return;
    }

    // Ctrl+N and Ctrl+P are the system's own keys for the next and the previous
    // line in a text field on a Mac. The menu is not known to the system, so
    // while it is open they are taken for its rows, and nothing else changes.
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const key = event.key.toLowerCase();
    const down = event.key === "ArrowDown" || (ctrl && key === "n");
    const up = event.key === "ArrowUp" || (ctrl && key === "p");

    if (down || up) {
      event.preventDefault();
      const step = down ? 1 : -1;

      setNav({
        ...current,
        index: (selected + step + matching.length) % matching.length,
      });
    } else if (event.key === "Tab") {
      event.preventDefault();

      if (event.shiftKey) {
        setNav({ ...current, dismissed: true });
      } else {
        fill(command);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setNav({ ...current, dismissed: true });
    } else if (event.key === "Enter" && !event.shiftKey) {
      // Fills the command in and sends it in one go. The text is set as well,
      // so it stays in the box if the send is refused or is still waiting.
      event.preventDefault();
      fill(command);
      submit(event.altKey ? "alt" : "enter", `/${command.name} `);
    }
  }

  // The textarea calls this one, which is the one of the latest render.
  const onKeyDown = useRef(handleKeyDown);
  onKeyDown.current = handleKeyDown;

  // Before the screen is drawn, so the textarea and the chip layer change in
  // the same frame: a frame with both texts, or with neither, would show.
  useLayoutEffect(() => {
    setCommands({
      onKeyDown: (event) => onKeyDown.current(event),
      open,
      listId,
      activeId,
      chip: chipText,
    });

    return () => setCommands(null);
  }, [setCommands, open, listId, activeId, chipText]);

  // A press outside the box puts the menu away. One inside it, such as on a
  // button of the toolbar, does not.
  useEffect(() => {
    if (!open) {
      return;
    }

    const box = rootRef.current?.closest("[data-slot='prompt-input-box']");

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node && box?.contains(event.target))) {
        setNav((state) => ({ ...state, dismissed: true }));
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  // Keeps the highlighted row in view as the arrows move through a long list.
  useEffect(() => {
    if (selected >= 0) {
      rootRef.current?.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      data-slot="prompt-input-commands"
      className={cn(
        "mb-2 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 absolute inset-x-0 bottom-full z-10 flex flex-col overflow-hidden animate-in fade-in-0 motion-reduce:animate-none",
        className,
      )}
    >
      <p id={headingId} className="px-1.5 py-1 font-medium text-muted-foreground text-xs shrink-0">
        {query === "" ? label : queryLabel(query ?? "")}
      </p>
      <div id={listId} role="listbox" aria-labelledby={headingId} className="max-h-72 overflow-y-auto">
        {matching.map((command, index) => (
          <button
            key={command.id ?? command.name}
            id={optionId(index)}
            type="button"
            // An option of the listbox the textarea controls.
            role="option"
            aria-selected={index === selected}
            tabIndex={-1}
            className="gap-1.5 rounded-md px-1.5 py-1 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground flex w-full cursor-default items-center text-left outline-hidden select-none"
            // A press on a button would take focus from the textarea.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              fill(command);
              focus();
            }}
            // Not on enter: a list that scrolls under a still pointer would
            // take the highlight from the arrows.
            onMouseMove={() => {
              if (index !== selected) {
                setNav({ ...current, index });
              }
            }}
          >
            <span className="font-mono shrink-0">/{command.name}</span>
            {command.description && (
              <span className="text-muted-foreground min-w-0 flex-1 truncate">{command.description}</span>
            )}
            {command.badge && <span className="ml-auto shrink-0">{command.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The second row of the box: attach buttons, the model selector, the send
 * button. Everything in it sits at the end, next to the send button. Put
 * `mr-auto` on an item to move it to the start.
 */
function PromptInputToolbar({ className, children, ...props }: Omit<ComponentProps<typeof InputGroupAddon>, "align">) {
  const { variant, textareaRef } = usePromptInput();

  return (
    <InputGroupAddon
      {...props}
      // Under the text, or at the end of the row when it is one.
      align={variant === "compact" ? "inline-end" : "block-end"}
      onClick={(event) => focusTextarea(event, textareaRef)}
      className={cn(
        "data-[align=block-end]:px-3 data-[align=block-end]:pb-3 data-[align=inline-end]:py-0 data-[align=inline-end]:pr-3.5 justify-end",
        className,
      )}
    >
      {children}
    </InputGroupAddon>
  );
}

type PromptInputAttachButtonProps = Omit<ComponentProps<typeof InputGroupButton>, "type" | "size" | "onClick"> & {
  /** Which files the picker offers, as for a file input: `image/*,.pdf`. */
  accept?: string;
  multiple?: boolean;
  /** Names the button for screen readers. */
  label?: string;
};

/**
 * Opens the system file picker and hands the files to `onAddFiles`. It draws
 * nothing when there is no `onAddFiles`. The icon is a plus; pass children to
 * change it.
 */
function PromptInputAttachButton({
  accept,
  multiple = true,
  label = "Attach files",
  children,
  disabled: buttonDisabled,
  ...props
}: PromptInputAttachButtonProps) {
  const { onAddFiles, disabled } = usePromptInput();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!onAddFiles) {
    return null;
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];

          // So picking the same file again still counts as a change.
          event.target.value = "";

          if (files.length > 0) {
            onAddFiles(files);
          }
        }}
      />
      <InputGroupButton
        {...props}
        type="button"
        size="icon-sm"
        aria-label={label}
        disabled={disabled || buttonDisabled}
        onClick={() => inputRef.current?.click()}
      >
        {children ?? <PlusIcon />}
      </InputGroupButton>
    </>
  );
}

type PromptInputSubmitProps = Omit<ComponentProps<typeof InputGroupButton>, "type" | "size" | "variant" | "onClick"> & {
  /** Names the send button for screen readers. Defaults to "Send". */
  sendLabel?: string;
  /** Names the stop button for screen readers. Defaults to "Stop". */
  stopLabel?: string;
};

/**
 * Sends the text. While a reply streams it is a stop button when the box is
 * empty, or when nothing can be sent until the reply finishes. `children`
 * replace the arrow of the send button, for a count while it cools down, and
 * the spinner while a message is being sent stays.
 */
function PromptInputSubmit({
  sendLabel = "Send",
  stopLabel = "Stop",
  children,
  className,
  ...props
}: PromptInputSubmitProps) {
  const { streaming, canSend, stop, disabled, sending } = usePromptInput();

  if (streaming && !canSend && !sending) {
    return (
      <InputGroupButton
        {...props}
        type="button"
        size="icon-sm"
        variant="default"
        aria-label={stopLabel}
        className={cn("pointer-coarse:size-11", className)}
        disabled={disabled || !stop}
        onClick={stop}
      >
        <SquareIcon className="size-3 fill-current" />
      </InputGroupButton>
    );
  }

  return (
    <InputGroupButton
      {...props}
      type="submit"
      size="icon-sm"
      // Quiet while there is nothing to send, dark once there is, so the button
      // only stands out when pressing it would do something.
      variant={canSend ? "default" : "secondary"}
      aria-label={sendLabel}
      className={cn(
        "disabled:bg-foreground/10 disabled:text-muted-foreground disabled:opacity-100 pointer-coarse:size-11",
        className,
      )}
      disabled={!canSend}
    >
      {sending ? <Spinner className="motion-reduce:animate-none" /> : (children ?? <ArrowUpIcon />)}
    </InputGroupButton>
  );
}

/**
 * Below the box: run details such as tokens per second or usage. One row of
 * small muted text that wraps, lined up with the text in the box. It takes no
 * space when it is empty. It has no height limit, as what goes in it is yours:
 * add `max-h-24 overflow-y-auto` through `className` if it can grow long.
 */
function PromptInputFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-input-footer"
      className={cn(
        "gap-x-4 gap-y-1 px-4 pt-2 text-muted-foreground text-xs flex min-w-0 flex-wrap items-center empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

export {
  appendPromptText,
  checkPromptFiles,
  type PromptCommand,
  type PromptFileProblem,
  type PromptFileRules,
  PromptInput,
  PromptInputAttachButton,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBox,
  PromptInputCommands,
  PromptInputFooter,
  PromptInputQueue,
  PromptInputQueueItem,
  PromptInputQuote,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  usePromptInputActions,
};
