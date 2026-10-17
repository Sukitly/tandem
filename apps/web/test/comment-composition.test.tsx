// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CommentDraft } from "../src/comments/comment-box.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("comment shortcuts belong to the IME until its confirming events have settled", async () => {
  let now = 100;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const save = vi.fn(async () => {});
  const cancel = vi.fn();
  render(<CommentDraft onSave={save} onCancel={cancel} />);
  const input = screen.getByRole("textbox", { name: "Comment" });
  fireEvent.change(input, { target: { value: "A comment" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  expect(cancel).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  now += 11;
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229, ctrlKey: true });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(save).not.toHaveBeenCalled();
  now += 11;
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  await waitFor(() => expect(save).toHaveBeenCalledWith("A comment"));
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
  fireEvent.keyDown(input, { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
});
