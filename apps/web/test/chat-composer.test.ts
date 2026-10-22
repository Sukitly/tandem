// @vitest-environment jsdom

import type { CommentThread } from "@tandem/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MessageDraft } from "../src/app/message-draft.ts";
import { ChatComposer } from "../src/chat/chat-composer.tsx";
import type { QueuedMessage } from "../src/chat/transcript.ts";
import { stubBrowserForComposer } from "./composer-browser.ts";

vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openChange: vi.fn() })),
);

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => viewport.mobile }));

beforeEach(() => stubBrowserForComposer());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  viewport.mobile = false;
});

const idle = { busy: false, queued: [] as QueuedMessage[], onStop: vi.fn(), imageSupport: { kind: "none" } as const };
const messageBox = () => screen.getByRole("combobox", { name: "Message" }) as HTMLTextAreaElement;

test("while the server decides the text is the one being sent, and a taken message clears the box", async () => {
  let finish!: () => void;
  const onSend = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(createElement(ChatComposer, { ...idle, onSend }));
  fireEvent.change(messageBox(), { target: { value: "First" } });
  fireEvent.submit(messageBox().form as HTMLFormElement);
  expect(onSend).toHaveBeenCalledWith("First", [], [], "steer");
  expect(messageBox().readOnly).toBe(true);
  await act(async () => finish());
  expect(messageBox().value).toBe("");
  expect(messageBox().readOnly).toBe(false);
});

test("a message the server refuses stays in the box, with the reason", async () => {
  const onSend = vi.fn().mockRejectedValue(new Error("The agent is not available"));
  render(createElement(ChatComposer, { ...idle, onSend }));
  fireEvent.change(messageBox(), { target: { value: "Hello" } });
  fireEvent.submit(messageBox().form as HTMLFormElement);
  expect(await screen.findByText("The agent is not available")).toBeDefined();
  expect(messageBox().value).toBe("Hello");
  await waitFor(() => expect(messageBox().readOnly).toBe(false));
});

test("a send that was not made because another is under way leaves the text where it is", async () => {
  const draft = new MessageDraft();
  let finish!: () => void;
  const first = draft.send(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(createElement(ChatComposer, { ...idle, draft, onSend }));
  fireEvent.change(messageBox(), { target: { value: "Second" } });
  fireEvent.submit(messageBox().form as HTMLFormElement);
  await act(async () => {});
  expect(onSend).not.toHaveBeenCalled();
  expect(messageBox().value).toBe("Second");
  finish();
  await act(async () => {
    await first;
  });
});

describe("queued chat messages", () => {
  const props = { busy: true, onSend: vi.fn(), onStop: vi.fn(), imageSupport: { kind: "accepted" } as const };
  const queue = () => screen.queryByRole("region", { name: "Queued messages" });
  /** The rows of the queue that are there to stay: one that is on its way out is hidden from readers. */
  const rows = () =>
    [...(queue()?.querySelectorAll<HTMLElement>('[data-slot="prompt-input-queue-item"]') ?? [])].filter(
      (row) => row.getAttribute("aria-hidden") !== "true",
    );

  test("lists what the agent has not taken up yet, oldest first, each as steering or as a follow-up", () => {
    const queued: QueuedMessage[] = [
      { id: 1, mode: "steer", text: "First message", imageCount: 0 },
      { id: 2, mode: "followUp", text: "Second message", imageCount: 0 },
    ];
    render(createElement(ChatComposer, { ...props, queued }));
    expect(rows()).toHaveLength(2);
    expect(within(rows()[0] as HTMLElement).getByText("Steering")).toBeDefined();
    expect(within(rows()[0] as HTMLElement).getByText("First message")).toBeDefined();
    expect(within(rows()[1] as HTMLElement).getByText("Follow-up")).toBeDefined();
    expect(within(rows()[1] as HTMLElement).getByText("Second message")).toBeDefined();
  });

  test("updates without retaining messages already consumed by the agent", async () => {
    const queued: QueuedMessage[] = [
      { id: 1, mode: "steer", text: "First message", imageCount: 0 },
      { id: 2, mode: "followUp", text: "Second message", imageCount: 0 },
    ];
    const { rerender } = render(createElement(ChatComposer, { ...props, queued }));
    rerender(createElement(ChatComposer, { ...props, queued: queued.slice(1) }));
    // A row that is taken up fades out before it is gone.
    await waitFor(() => expect(screen.queryByText("First message")).toBeNull());
    expect(screen.getByText("Second message")).toBeDefined();
    rerender(createElement(ChatComposer, { ...props, queued: [] }));
    await waitFor(() => expect(queue()).toBeNull());
  });

  test("says how many images go with a message", () => {
    render(
      createElement(ChatComposer, {
        ...props,
        queued: [
          { id: 1, mode: "followUp", text: "One", imageCount: 1 },
          { id: 2, mode: "followUp", text: "Two", imageCount: 2 },
          { id: 3, mode: "followUp", text: "None", imageCount: 0 },
        ],
      }),
    );
    expect(screen.getByText("1 image")).toBeDefined();
    expect(screen.getByText("2 images")).toBeDefined();
    expect(screen.queryByText("0 images")).toBeNull();
  });

  test("is joined to the box, and the comments that wait to be sent are above both, and can be taken back", () => {
    const thread: CommentThread = {
      id: 7,
      workspaceId: 1,
      anchor: { path: "src/app.ts", line: 12, quote: "", before: [], after: [] },
      messages: [{ id: 70, author: "user", text: "Why this?", createdAt: 0 }],
    };
    const comment = { thread, messageId: 70, text: "Why this?" };
    const onWithdrawComment = vi.fn();
    render(
      createElement(ChatComposer, {
        ...props,
        queued: [{ id: 1, mode: "steer", text: "Steer", imageCount: 0 }],
        comments: [comment],
        onWithdrawComment,
      }),
    );
    const comments = screen.getByRole("list", { name: "Comments to send" });
    expect(within(comments).getByText("Why this?")).toBeDefined();
    expect(within(queue() as HTMLElement).queryByText("Why this?")).toBeNull();
    expect(comments.compareDocumentPosition(queue() as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The queue and the box must be neighbours, or the two do not read as one card.
    expect(queue()?.nextElementSibling?.getAttribute("data-slot")).toBe("prompt-input-box");

    fireEvent.click(screen.getByRole("button", { name: "Take back the comment on src/app.ts:12" }));
    expect(onWithdrawComment).toHaveBeenCalledWith(comment);
  });

  test("has no summary and no queue when nothing waits, on a desktop or a phone", () => {
    for (const mobile of [false, true]) {
      viewport.mobile = mobile;
      const { unmount } = render(createElement(ChatComposer, { ...props, queued: [] }));
      expect(queue()).toBeNull();
      unmount();
    }
  });

  test.each([false, true])("shows queued messages directly, without a collapsed summary (mobile: %s)", (mobile) => {
    viewport.mobile = mobile;
    render(
      createElement(ChatComposer, {
        ...props,
        queued: [{ id: 1, mode: "followUp", text: "Later", imageCount: 0 }],
      }),
    );
    expect(screen.getByText("Later")).toBeDefined();
    expect(screen.queryByText(/queued messages ·/)).toBeNull();
  });
});
