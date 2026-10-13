// @vitest-environment jsdom

import type { ModelSummary } from "@tandem/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ChatComposer, type ImageSupport, imageSupportOf } from "../src/chat/chat-composer.tsx";

vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({ openChange: vi.fn() }),
}));

beforeAll(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

const png = (name = "shot.png") => new File(["png"], name, { type: "image/png" });

function composer(imageSupport: ImageSupport, onSend = vi.fn().mockResolvedValue(undefined)) {
  render(createElement(ChatComposer, { busy: false, queued: [], onSend, onStop: vi.fn(), imageSupport }));
  return { textarea: screen.getByLabelText("Message") as HTMLTextAreaElement, onSend };
}

/** Paste files into the box, as a browser does with an image on the clipboard. */
function paste(textarea: HTMLTextAreaElement, files: File[]): void {
  fireEvent.paste(textarea, { clipboardData: { files } });
}

describe("images in the message box", () => {
  test("a pasted image shows as a thumbnail, can be removed, and goes with the message", async () => {
    const { textarea, onSend } = composer({ kind: "accepted" });
    paste(textarea, [png("one.png"), png("two.png")]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual(["two.png"]);

    // Images alone are a message.
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith("", [], [{ data: btoa("png"), mimeType: "image/png" }], "steer");
    await waitFor(() => expect(screen.queryAllByRole("img")).toHaveLength(0));
  });

  test("images stay in the box when the message is refused", async () => {
    const { textarea } = composer({ kind: "accepted" }, vi.fn().mockRejectedValue(new Error("Too many images")));
    paste(textarea, [png()]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Too many images")).toBeDefined());
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  test("keeps no more than the model takes in a message, and says so", async () => {
    const { textarea } = composer({ kind: "accepted", maxPerMessage: 1 });
    paste(textarea, [png("one.png"), png("two.png")]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
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
    expect(screen.queryAllByRole("img")).toHaveLength(0);
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
