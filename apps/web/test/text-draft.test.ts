import { expect, test, vi } from "vitest";
import { MessageDraft } from "../src/app/message-draft.ts";
import { TextDraft } from "../src/app/text-draft.ts";

test("reset permits reuse and invalidates a pending send", async () => {
  const draft = new TextDraft("First");
  let finish!: () => void;
  const pending = draft.send(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  draft.reset();
  draft.setText("New draft");
  finish();
  expect(await pending).toBe(false);
  expect(draft.getSnapshot()).toEqual({ text: "New draft", sending: false, error: null });
});

test.each([TextDraft, MessageDraft])("disposed drafts cannot be reused", async (Draft) => {
  const draft = new Draft("Before");
  draft.dispose();
  const notify = vi.fn();
  const submit = vi.fn(async () => {});
  draft.subscribe(notify);
  draft.reset();
  draft.setText("After");
  draft.setError("After");
  expect(await draft.send(submit)).toBe(false);
  expect(draft.getSnapshot().text).toBe("");
  expect(draft.getSnapshot().error).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

test("text-only drafts do not expose attachment operations", () => {
  const draft = new TextDraft();
  expect("attach" in draft).toBe(false);
  expect("images" in draft.getSnapshot()).toBe(false);
});
