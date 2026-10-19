// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Drafts, DraftsProvider, useMessageDraft } from "../src/app/drafts.tsx";
import { MessageDraft } from "../src/app/message-draft.ts";
import { ChatComposer } from "../src/chat/chat-composer.tsx";
import { CommentDraft } from "../src/comments/comment-box.tsx";

vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => window.innerWidth < 768 }));
vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openChange: vi.fn() })),
);
vi.mock("../src/comments/use-comment-width.ts", () => ({ useCommentWidth: () => undefined }));
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:draft");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

function Composer({ id, onSend = async () => {} }: { id: string; onSend?: () => Promise<void> }) {
  const draft = useMessageDraft(id);
  return (
    <ChatComposer
      draft={draft}
      busy={false}
      queued={[]}
      imageSupport={{ kind: "accepted" }}
      onSend={onSend}
      onStop={() => {}}
    />
  );
}
const input = () => screen.getByRole("combobox", { name: "Message" }) as HTMLTextAreaElement;

function page(id: string | null, layout = "desktop", onSend?: () => Promise<void>) {
  return (
    <StrictMode>
      <DraftsProvider>
        {id === null ? <p>Reconnecting</p> : <Composer key={layout + id} id={id} onSend={onSend} />}
      </DraftsProvider>
    </StrictMode>
  );
}

test("text and images survive conversation, connection, and responsive view replacement", async () => {
  const { rerender, unmount } = render(page("conversation:1"));
  fireEvent.change(input(), { target: { value: "First draft" } });
  fireEvent.paste(input(), { clipboardData: { files: [new File(["png"], "one.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByRole("img")).toBeDefined());
  rerender(page("conversation:2"));
  expect(input().value).toBe("");
  fireEvent.change(input(), { target: { value: "Second draft" } });
  rerender(page(null));
  rerender(page("conversation:1", "mobile"));
  expect(input().value).toBe("First draft");
  expect(screen.getByRole("img").getAttribute("alt")).toBe("one.png");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  rerender(page("conversation:2"));
  expect(input().value).toBe("Second draft");
  unmount();
  await Promise.resolve();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft");
});

test("a pending send follows the draft across remounts and preserves later edits", async () => {
  let finish!: () => void;
  const onSend = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(page("conversation:1", "desktop", onSend));
  fireEvent.change(input(), { target: { value: "Sent" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  rerender(page(null));
  rerender(page("conversation:1", "mobile", onSend));
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input(), { target: { value: "Keep this" } });
  await act(async () => finish());
  expect(input().value).toBe("Keep this");
  expect(onSend).toHaveBeenCalledTimes(1);
});

test("a failed send remains actionable after its original view unmounts", async () => {
  let fail!: (error: Error) => void;
  const onSend = () =>
    new Promise<void>((_, reject) => {
      fail = reject;
    });
  const { rerender } = render(page("conversation:1", "desktop", onSend));
  fireEvent.change(input(), { target: { value: "Retry me" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  rerender(page(null));
  await act(async () => fail(new Error("Offline")));
  rerender(page("conversation:1"));
  expect(input().value).toBe("Retry me");
  expect(screen.getByText("Offline")).toBeDefined();
});

test("new conversation adoption retains post-submit input and clears the old workspace slot", async () => {
  const drafts = new Drafts();
  const draft = drafts.message("new:1");
  draft.setText("Send");
  let finish!: () => void;
  const sending = draft.send(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  draft.setText("Next");
  drafts.move("new:1", "conversation:2");
  finish();
  await sending;
  expect(drafts.message("conversation:2").getSnapshot().text).toBe("Next");
  expect(drafts.message("new:1").getSnapshot().text).toBe("");
});

test("message moves preserve both drafts and their subscribers on collision", () => {
  const drafts = new Drafts();
  const source = drafts.message("new:1", "Unsent source");
  const target = drafts.message("conversation:2", "Unsent target");
  const notify = vi.fn();
  target.subscribe(notify);
  expect(drafts.move("new:1", "new:1")).toBe("moved");
  expect(drafts.message("new:1")).toBe(source);
  expect(drafts.move("new:1", "conversation:2")).toBe("conflict");
  expect(drafts.message("new:1")).toBe(source);
  expect(drafts.message("conversation:2")).toBe(target);
  expect(target.getSnapshot().text).toBe("Unsent target");
  expect(source.getSnapshot().text).toBe("Unsent source");
  target.setText("Still subscribed");
  expect(notify).toHaveBeenCalledOnce();
  drafts.dispose();
});

test("editing away and back to the submitted text still counts as a new draft", async () => {
  const draft = new MessageDraft("same");
  let finish!: () => void;
  const sending = draft.send(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  draft.setText("other");
  draft.setText("same");
  finish();
  await sending;
  expect(draft.getSnapshot().text).toBe("same");
});

test("comment drafts survive remounts, preserve initial edit text under StrictMode, and lock during save", async () => {
  let finish!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const cancel = vi.fn();
  const comment = (shown: boolean) => (
    <StrictMode>
      <DraftsProvider>
        {shown && <CommentDraft draftKey="edit:1" initial="Existing" onSave={save} onCancel={cancel} />}
      </DraftsProvider>
    </StrictMode>
  );
  const { rerender } = render(comment(true));
  const text = () => screen.getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement;
  await act(async () => {});
  expect(text().value).toBe("Existing");
  fireEvent.change(text(), { target: { value: "My edit" } });
  rerender(comment(false));
  rerender(comment(true));
  expect(text().value).toBe("My edit");
  fireEvent.keyDown(text(), { key: "Escape", isComposing: true });
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  expect(text().disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish());
  expect(save).toHaveBeenCalledWith("My edit");
});

test("concurrent attachments share the byte and model limits", async () => {
  const draft = new MessageDraft();
  const first = new File(["a"], "first.png", { type: "image/png" });
  const second = new File(["b"], "second.png", { type: "image/png" });
  Object.defineProperty(first, "size", { value: 6 * 1024 * 1024 });
  Object.defineProperty(second, "size", { value: 6 * 1024 * 1024 });
  await Promise.all([draft.attach([first]), draft.attach([second])]);
  expect(draft.getSnapshot().images.map((image) => image.name)).toEqual(["first.png"]);
  expect(draft.getSnapshot().error).toContain("MB together");
  draft.reset();
  await Promise.all([
    draft.attach([new File(["a"], "a.png", { type: "image/png" })], 1),
    draft.attach([new File(["b"], "b.png", { type: "image/png" })], 1),
  ]);
  expect(draft.getSnapshot().images).toHaveLength(1);
  expect(draft.getSnapshot().error).toContain("at most 1 images");
  draft.dispose();
});

test("disposing a draft revokes images whose asynchronous reads complete later", async () => {
  const draft = new MessageDraft();
  const reading = draft.attach([new File(["a"], "a.png", { type: "image/png" })]);
  await Promise.resolve();
  draft.dispose();
  await reading;
  expect(draft.getSnapshot().images).toHaveLength(0);
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft");
});

test("a disposed message cannot attach more images or notify subscribers", async () => {
  const draft = new MessageDraft();
  const notify = vi.fn();
  draft.subscribe(notify);
  draft.dispose();
  notify.mockClear();
  await draft.attach([new File(["a"], "a.png", { type: "image/png" })]);
  draft.setText("Not live");
  expect(draft.getSnapshot().images).toEqual([]);
  expect(draft.getSnapshot().text).toBe("");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

test("Escape cancels only the comment editor", () => {
  const outer = vi.fn();
  const cancel = vi.fn();
  render(
    <dialog open onKeyDown={outer}>
      <CommentDraft onSave={async () => {}} onCancel={cancel} />
    </dialog>,
  );
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
});
