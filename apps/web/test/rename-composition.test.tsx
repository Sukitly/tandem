// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RenameConversationDialog } from "../src/chat/conversation-menu.tsx";

const rename = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ renameConversation: rename }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  rename.mockClear();
});
test("IME confirmation and Safari's trailing Enter do not rename a conversation", async () => {
  const time = vi.spyOn(Date, "now").mockReturnValue(1000);
  render(
    <RenameConversationDialog
      open
      onOpenChange={() => {}}
      summary={{ id: 1, workspaceId: 1, title: "Before", cwd: "/project", createdAt: 0, updatedAt: 0, running: false }}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Conversation title" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "新的标题" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(rename).not.toHaveBeenCalled();
  time.mockReturnValue(1020);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(rename).toHaveBeenCalledWith(1, "新的标题"));
});
