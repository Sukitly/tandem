// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  test("updates the queue without retaining messages already consumed by the agent", () => {
    const props = { busy: true, onSend: vi.fn(), onStop: vi.fn(), imageSupport: { kind: "accepted" } as const };
    const queued: QueuedMessage[] = [
      { id: 1, mode: "steer", text: "First message", imageCount: 0 },
      { id: 2, mode: "followUp", text: "Second message", imageCount: 0 },
    ];
    const { rerender } = render(createElement(ChatComposer, { ...props, queued }));
    expect(screen.getByText("First message")).toBeDefined();
    expect(screen.getByText("Second message")).toBeDefined();
    rerender(createElement(ChatComposer, { ...props, queued: queued.slice(1) }));
    expect(screen.queryByText("First message")).toBeNull();
    expect(screen.getByText("Second message")).toBeDefined();
    rerender(createElement(ChatComposer, { ...props, queued: [] }));
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });
  test.each([false, true])("shows queued messages directly, without a collapsed summary (mobile: %s)", (mobile) => {
    viewport.mobile = mobile;
    render(
      createElement(ChatComposer, {
        busy: true,
        queued: [{ id: 1, mode: "followUp", text: "Later", imageCount: 0 }],
        onSend: vi.fn(),
        onStop: vi.fn(),
        imageSupport: { kind: "accepted" },
      }),
    );
    expect(screen.getByText("Later")).toBeDefined();
    expect(screen.queryByText(/queued messages ·/)).toBeNull();
  });
});
