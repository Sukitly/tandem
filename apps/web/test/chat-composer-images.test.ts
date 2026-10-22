// @vitest-environment jsdom

import type { ModelSummary } from "@tandem/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ChatComposer, type ImageSupport, imageSupportOf } from "../src/chat/chat-composer.tsx";
import { stubBrowserForComposer } from "./composer-browser.ts";

vi.mock("../src/hooks/use-mobile.ts", () => ({ useIsMobile: () => window.innerWidth < 768 }));
vi.mock("../src/app/workbench.tsx", async () =>
  (await import("./workbench-mock.ts")).workbenchMock(() => ({ openChange: vi.fn() })),
);

beforeAll(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => stubBrowserForComposer());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const png = (name = "shot.png") => new File(["png"], name, { type: "image/png" });

function composer(imageSupport: ImageSupport, onSend = vi.fn().mockResolvedValue(undefined)) {
  render(createElement(ChatComposer, { busy: false, queued: [], onSend, onStop: vi.fn(), imageSupport }));
  return { textarea: screen.getByLabelText("Message") as HTMLTextAreaElement, onSend };
}

/** The pictures waiting to be sent, by name, as the box lists them. */
function tiles(): string[] {
  const row = screen.queryByRole("list", { name: "Images" });
  return row === null
    ? []
    : within(row)
        .getAllByRole("listitem")
        .map((tile) => tile.textContent ?? "");
}

/** Paste files into the box, as a browser does with an image on the clipboard. */
function paste(textarea: HTMLTextAreaElement, files: File[]): void {
  fireEvent.paste(textarea, { clipboardData: { files } });
}

describe("images in the message box", () => {
  test("a pasted image shows as a thumbnail, can be removed, and goes with the message", async () => {
    const { textarea, onSend } = composer({ kind: "accepted" });
    paste(textarea, [png("one.png"), png("two.png")]);
    await waitFor(() => expect(tiles()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0]).toContain("two.png");

    // Images alone are a message.
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith("", [], [{ data: btoa("png"), mimeType: "image/png" }], "steer");
    await waitFor(() => expect(tiles()).toEqual([]));
  });

  test("images stay in the box when the message is refused", async () => {
    const { textarea } = composer({ kind: "accepted" }, vi.fn().mockRejectedValue(new Error("Too many images")));
    paste(textarea, [png()]);
    await waitFor(() => expect(tiles()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Too many images")).toBeDefined());
    expect(tiles()).toHaveLength(1);
  });

  test("keeps no more than the model takes in a message, and says so", async () => {
    const { textarea } = composer({ kind: "accepted", maxPerMessage: 1 });
    paste(textarea, [png("one.png"), png("two.png")]);
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(screen.getByText("The current model takes at most 1 images in a message")).toBeDefined();
  });

  test.each([
    [{ kind: "none" } as const, "The current model does not take images. Choose one that does."],
    [{ kind: "unknown" } as const, "Choose an available model before sending images."],
  ])("for a model that cannot take them (%o) is not offered, and a paste says why", async (support, message) => {
    const { textarea } = composer(support);
    expect(screen.queryByRole("button", { name: "Attach images" })).toBeNull();
    paste(textarea, [png()]);
    await waitFor(() => expect(screen.getByText(message)).toBeDefined());
    expect(tiles()).toEqual([]);
  });

  test("an image dropped on the box is attached, and so is one picked with the button", async () => {
    const { textarea } = composer({ kind: "accepted" });
    const form = textarea.form as HTMLFormElement;
    fireEvent.drop(form, { dataTransfer: { files: [png("dropped.png")], types: ["Files"] } });
    await waitFor(() => expect(tiles()).toHaveLength(1));

    const picker = document.querySelector("input[type=file]") as HTMLInputElement;
    expect(picker.accept).toContain("image/png");
    fireEvent.change(picker, { target: { files: [png("picked.png")] } });
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(tiles()[1]).toContain("picked.png");
  });

  test("a file that is not an image is not attached, and says so", async () => {
    const { textarea } = composer({ kind: "accepted" });
    const note = new File(["x"], "notes.txt", { type: "text/plain" });
    expect(fireEvent.paste(textarea, { clipboardData: { files: [note] } })).toBe(false);
    await waitFor(() => expect(screen.getByText("Only images can be attached.")).toBeDefined());
    expect(tiles()).toEqual([]);
  });

  test("a paste of text is the browser's", () => {
    const { textarea } = composer({ kind: "accepted" });
    expect(fireEvent.paste(textarea, { clipboardData: { files: [] } })).toBe(true);
  });
});

describe("what a model takes of images", () => {
  const model = (images?: ModelSummary["images"]): ModelSummary => ({
    provider: "p",
    modelId: "m",
    name: "M",
    thinkingLevels: ["off"],
    contextWindow: 1,
    ...(images === undefined ? {} : { images }),
  });
  const ref = { provider: "p", modelId: "m" };

  test("is what its summary says", () => {
    expect(imageSupportOf([model({ maxPerMessage: 3 })], ref)).toEqual({ kind: "accepted", maxPerMessage: 3 });
    expect(imageSupportOf([model({})], ref)).toEqual({ kind: "accepted" });
    expect(imageSupportOf([model()], ref)).toEqual({ kind: "none" });
  });

  test("is unknown for a model that is not available, or no model", () => {
    expect(imageSupportOf([model({})], { provider: "p", modelId: "other" })).toEqual({ kind: "unknown" });
    expect(imageSupportOf([model({})], undefined)).toEqual({ kind: "unknown" });
    expect(imageSupportOf(undefined, ref)).toEqual({ kind: "unknown" });
  });
});
