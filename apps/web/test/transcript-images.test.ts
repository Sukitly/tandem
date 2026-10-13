// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { TranscriptImages } from "../src/chat/transcript-images.tsx";
import { TooltipProvider } from "../src/components/ui/tooltip.tsx";

vi.mock("../src/rpc/connection.tsx", () => ({ useConnected: () => ({ imageUrl: () => "/image/server/1/2/0/1" }) }));
afterEach(cleanup);
const image = {
  type: "image" as const,
  mimeType: "image/png",
  ref: { conversationId: 1, entryId: 2, messageIndex: 0, blockIndex: 1 },
};

test("a transcript image loads by same-origin URL without a token and opens in a dialog", async () => {
  render(createElement(TranscriptImages, { images: [image] }));
  expect(screen.getByRole("img").getAttribute("src")).toBe("/image/server/1/2/0/1");
  fireEvent.click(screen.getByRole("button", { name: "Show image 1" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
  expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(2);
});
test("queued images explain why they cannot be fetched yet", () => {
  render(
    createElement(
      TooltipProvider,
      null,
      createElement(TranscriptImages, { images: [{ type: "image", mimeType: "image/png" }] }),
    ),
  );
  expect(screen.getByRole("button", { name: /sent once the message is taken/ })).toBeDefined();
  expect(screen.queryByRole("img")).toBeNull();
});
test("an image load failure is visible and contains no native title tooltip", () => {
  render(createElement(TooltipProvider, null, createElement(TranscriptImages, { images: [image] })));
  fireEvent.error(screen.getByRole("img"));
  const placeholder = screen.getByRole("button", { name: /could not be loaded/ });
  expect(placeholder.getAttribute("title")).toBeNull();
});
