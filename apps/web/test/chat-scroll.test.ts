// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatView } from "../src/chat/chat-view.tsx";

const mock = vi.hoisted(() => ({
  submit: vi.fn(),
  scrollToEnd: vi.fn(),
  view: { docs: {} },
  transcript: {
    items: [],
    busy: false,
    silent: false,
    turnHasContent: false,
    queued: [],
    usage: { tokens: 0, cost: 0 },
  },
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    conversations: { state: { conversations: [] } },
    models: { state: { models: [] } },
  }),
}));
vi.mock("../src/rpc/use-conversation.ts", () => ({
  useConversation: () => ({ view: mock.view, submit: mock.submit }),
  useConversationFailure: () => undefined,
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
vi.mock("../src/rpc/use-prompts.ts", () => ({ usePrompts: () => ({ commands: [] }) }));
vi.mock("../src/app/sidebar.tsx", () => ({ SidebarToggle: () => null }));
vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({ filesShown: false, showFiles: vi.fn() }),
}));
vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => false }));
vi.mock("../src/chat/status-bar.tsx", () => ({ StatusBar: () => null }));
vi.mock("../src/chat/usage-line.tsx", () => ({ UsageLine: () => null }));
vi.mock("../src/chat/pull-request-line.tsx", () => ({ PullRequestLine: () => null }));
vi.mock("../src/chat/transcript.ts", () => ({ toTranscript: () => mock.transcript }));
vi.mock("../src/components/ui/message-scroller.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/ui/message-scroller.tsx")>();
  return {
    ...actual,
    useMessageScroller: () => {
      // Keep the real hook so the send handler must live inside the scroller provider.
      const scroller = actual.useMessageScroller();
      return { ...scroller, scrollToEnd: mock.scrollToEnd };
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.transcript.busy = false;
  mock.submit.mockResolvedValue(undefined);
});
afterEach(cleanup);

function send(modifiers = {}) {
  const textarea = screen.getByLabelText("Message");
  fireEvent.change(textarea, { target: { value: "New message" } });
  fireEvent.keyDown(textarea, { key: "Enter", ...modifiers });
}

test("sending successfully resumes following the bottom even when reading older messages", async () => {
  let accept = () => {};
  mock.submit.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  render(createElement(ChatView, { conversationId: 1 }));
  expect(screen.getByRole("log", { name: "Transcript" }).classList.contains("chat-transcript-scrollbar")).toBe(true);
  // Browsing history must not jump back to the bottom until this client successfully sends.
  fireEvent.wheel(screen.getByRole("log", { name: "Transcript" }), { deltaY: -100 });
  expect(mock.scrollToEnd).not.toHaveBeenCalled();
  send();
  expect(mock.submit).toHaveBeenCalledWith({ text: "New message", comments: [], whenBusy: "steer" }, expect.anything());
  expect(mock.scrollToEnd).not.toHaveBeenCalled();
  await act(async () => accept());
  expect(mock.scrollToEnd).toHaveBeenCalledExactlyOnceWith({ behavior: "auto" });
});

test.each([
  ["steer", {}],
  ["followUp", { altKey: true }],
] as const)("sending a %s while busy also returns to the bottom", async (whenBusy, modifiers) => {
  mock.transcript.busy = true;
  render(createElement(ChatView, { conversationId: 1 }));
  send(modifiers);
  await waitFor(() => expect(mock.scrollToEnd).toHaveBeenCalledOnce());
  expect(mock.submit.mock.calls[0]?.[0].whenBusy).toBe(whenBusy);
});

test("failed sends preserve the draft and do not force a scroll", async () => {
  mock.submit.mockRejectedValue(new Error("Send failed"));
  render(createElement(ChatView, { conversationId: 1 }));
  send();
  await waitFor(() => expect(screen.getByText("Send failed")).toBeDefined());
  expect(mock.scrollToEnd).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("New message");
});

test("subscription updates alone do not force a reader back to the bottom", () => {
  const { rerender } = render(createElement(ChatView, { conversationId: 1 }));
  fireEvent.wheel(screen.getByRole("log", { name: "Transcript" }), { deltaY: -100 });
  mock.transcript.busy = true;
  rerender(createElement(ChatView, { conversationId: 1 }));
  expect(mock.scrollToEnd).not.toHaveBeenCalled();
});
