// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AssistantPart, TranscriptItem } from "../src/chat/transcript.ts";
import { TranscriptEntry } from "../src/chat/transcript-items.tsx";
import { inTranscript } from "./in-transcript.ts";

vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ imageUrl: (ref: { blockIndex: number }) => `/image/${ref.blockIndex}` }),
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

const picture = (blockIndex: number) => ({
  type: "image" as const,
  mimeType: "image/png",
  ref: { conversationId: 1, entryId: 2, messageIndex: 0, blockIndex },
});
const queued = { type: "image" as const, mimeType: "image/png" };

function user(text: string, images: Extract<TranscriptItem, { kind: "user" }>["images"] = []) {
  const item: TranscriptItem = { kind: "user", key: "user", text, images };
  return render(inTranscript(<TranscriptEntry item={item} />));
}

function assistant(ending: "complete" | "streaming", ...parts: AssistantPart[]) {
  const item: TranscriptItem = { kind: "assistant", key: "reply", ending, parts };
  return render(inTranscript(<TranscriptEntry item={item} />));
}

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

test("what the person typed is shown as typed, not parsed as markdown", () => {
  const { container } = user("**not bold** and `not code`\n\n- not a list");
  expect(screen.getByText(/\*\*not bold\*\* and `not code`/)).toBeDefined();
  expect(container.querySelector("strong, code, ul, li")).toBeNull();
});

test("a message is copied as typed, and the button says so", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  clipboard(writeText);
  user("**keep** the markdown");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeDefined());
  expect(writeText).toHaveBeenCalledExactlyOnceWith("**keep** the markdown");
});

test("a copy that fails says so on the button and can be tried again", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Permission denied")).mockResolvedValueOnce(undefined);
  clipboard(writeText);
  user("hello");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Could not copy" })).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Could not copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeDefined());
  expect(writeText).toHaveBeenCalledTimes(2);
});

test("a copy with no clipboard in the page says so too", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  user("hello");
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Could not copy" })).toBeDefined());
});

test("a message of only images has no bubble and nothing to copy", () => {
  const { container } = user("", [picture(1)]);
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  expect(container.querySelector("[data-slot=bubble]")).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/image/1");
});

test("images load by the same-origin address, with no token, and open in a viewer that steps through them", async () => {
  const { container } = user("look", [picture(1), picture(2)]);
  expect([...container.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
    "/image/1",
    "/image/2",
  ]);
  expect(screen.getByRole("list", { name: "Images" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "View Image 2" }));
  const dialog = await screen.findByRole("dialog", { name: "Image 2" });
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/image/2");
  fireEvent.click(within(dialog).getByRole("button", { name: "Previous image" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Image 1" }).querySelector("img")?.getAttribute("src")).toBe("/image/1"),
  );
});

test("an image that is not stored yet is a tile that says it is not sent yet, and has no picture to show", () => {
  const { container } = user("look", [queued]);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
  expect(screen.getByTitle("Image 1: Not sent yet")).toBeDefined();
  expect(screen.getByText("Not sent yet")).toBeDefined();
});

test("an image that cannot be loaded is a tile that says so, with no view button", () => {
  const { container } = user("look", [picture(1)]);
  fireEvent.error(container.querySelector("img") as HTMLImageElement);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("Could not load")).toBeDefined();
  expect(screen.getByTitle("Image 1: Could not load")).toBeDefined();
  expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
});

test("a finished answer can be copied as the text of the reply, once", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  clipboard(writeText);
  assistant("complete", { kind: "text", text: "First paragraph." }, { kind: "text", text: "Second paragraph." });
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeDefined());
  expect(writeText).toHaveBeenCalledExactlyOnceWith("First paragraph.\n\nSecond paragraph.");
});

test("a reply that is still streaming, or has no text, or ran tools, has no copy button", () => {
  assistant("streaming", { kind: "text", text: "Partial" });
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  cleanup();
  assistant("complete");
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  cleanup();
  assistant(
    "complete",
    { kind: "tool", callId: "1", name: "ls", args: {}, status: "done", output: "", images: [] },
    { kind: "text", text: "Done" },
  );
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
});
