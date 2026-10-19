// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DeleteConversationDialog, RenameConversationDialog } from "../src/chat/conversation-menu.tsx";

const mock = vi.hoisted(() => ({ rename: vi.fn(), remove: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mock.error } }));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ conversations: { rename: mock.rename, remove: mock.remove } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const summary = { id: 7, workspaceId: 1, title: "Before", cwd: "/project", createdAt: 0, updatedAt: 0, running: false };

test("a rename the server refuses is reported, and the dialog stays for another try", async () => {
  mock.rename.mockRejectedValueOnce(new Error("Title is taken")).mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(<RenameConversationDialog open onOpenChange={onOpenChange} summary={summary} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Conversation title" }), { target: { value: "After" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mock.error).toHaveBeenCalledWith("Could not rename the conversation", { description: "Title is taken" }),
  );
  expect(onOpenChange).not.toHaveBeenCalled();
  await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mock.rename).toHaveBeenLastCalledWith(7, "After", expect.anything());
});

test("a deletion the server refuses is reported, and the dialog stays; one it accepts closes it", async () => {
  mock.remove.mockRejectedValueOnce(new Error("Still running")).mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(<DeleteConversationDialog open onOpenChange={onOpenChange} summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(mock.error).toHaveBeenCalledWith("Could not delete the conversation", { description: "Still running" }),
  );
  expect(onOpenChange).not.toHaveBeenCalled();

  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mock.remove).toHaveBeenLastCalledWith(7, expect.anything());
});
