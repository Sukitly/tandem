import type { PromptTemplateSummary } from "@tandem/contracts";
import { cn } from "cn";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CommentList } from "@/comments/comment-list.tsx";
import type { WaitingComment } from "@/comments/project-comments.ts";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import type { QueuedMessage } from "./transcript.ts";

/**
 * How long after a composition ends a keydown still counts as the IME's. Safari delivers the closing keydown after
 * `compositionend`, so `isComposing` alone would let an IME's Enter submit or pick a command.
 */
const IME_SETTLE_MS = 10;

export interface ChatComposerProps {
  busy: boolean;
  queued: QueuedMessage[];
  /** Comments of the project waiting to be sent; they go with the message, which the server writes them into. */
  comments?: WaitingComment[];
  onWithdrawComment?(comment: WaitingComment): void;
  /** The project's slash commands, offered while a message begins with `/`. The server expands them when it is sent. */
  commands?: PromptTemplateSummary[];
  /** Rejects when the server refuses the message; the text then stays in the box, and the comments wait. */
  onSend: (text: string, comments: number[], whenBusy: "steer" | "followUp") => Promise<void>;
  onStop: () => void;
  autoFocus?: boolean;
  /** Shown under the box: the model, the thinking level, and how full the context is. */
  status?: ReactNode;
}

/**
 * The message box. While the agent works, Enter steers it (the message is read at its next step) and Alt+Enter queues
 * a follow-up for when it is done, as in pi's terminal UI. Shift+Enter starts a new line.
 *
 * The box is a combobox, and its suggestion menu is Tandem's own, laid over the box rather than rendered by a popover
 * or a menu component: focus must stay in the box so that ordinary typing, spaces, and Shift+Enter keep working, and
 * such a component would take the keys for itself. It follows how pi's own input behaves: a message that begins with
 * `/` and holds no argument yet offers the project's slash commands, the arrows and Tab move through them and settle
 * one, Escape puts the menu away, and everything else is left to the browser.
 */
export function ChatComposer({
  busy,
  queued,
  comments = [],
  onWithdrawComment,
  commands = [],
  onSend,
  onStop,
  autoFocus,
  status,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const composingUntil = useRef(0);
  const empty = value.trim() === "" && comments.length === 0;

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
    setValue(`/${command.name} `);
    setHighlight(0);
    setDismissed(false);
  };

  const send = async (whenBusy: "steer" | "followUp"): Promise<void> => {
    if (empty || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(
        value,
        comments.map((comment) => comment.messageId),
        whenBusy,
      );
      setValue("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const native = event.nativeEvent;
    // A key the input method owns, picking one of its candidates, is never ours: acting on it would fight the IME.
    if (native.isComposing || native.keyCode === 229 || composing.current || Date.now() < composingUntil.current)
      return;

    if (menuOpen) {
      const count = matching.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % count);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) => (current - 1 + count) % count);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        // Tab settles the highlighted command; Shift+Tab puts the menu away, so the two never disagree.
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
      if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const command = matching[selected];
        if (command !== undefined) accept(command);
        return;
      }
    }
    // Everything else is the browser's: ordinary characters and spaces, which close the menu by changing the message,
    // and Shift+Enter's line break.
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send(event.altKey ? "followUp" : "steer");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send("steer");
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
            </Item>
          ))}
        </ItemGroup>
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
                  // mousedown, not click: the box keeps focus, and the command is settled before a blur-driven teardown.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    accept(command);
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
        <form onSubmit={onSubmit}>
          <InputGroup>
            <InputGroupTextarea
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setHighlight(0);
                setDismissed(false);
              }}
              onKeyDown={onKeyDown}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                composingUntil.current = Date.now() + IME_SETTLE_MS;
              }}
              rows={1}
              className="max-h-60 min-h-0 py-2.5"
              aria-label="Message"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? listId : undefined}
              aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
              placeholder={busy ? "Steer the agent, or Alt+Enter to queue a follow-up" : "Ask the agent"}
              autoFocus={autoFocus}
            />
            <InputGroupAddon align="inline-end" className="self-end pb-1.5">
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
      </div>
      {status}
      {error !== null && <FieldError>{error}</FieldError>}
    </div>
  );
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
