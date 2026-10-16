// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { CopyPathButton } from "../src/components/copy-path-button.tsx";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("copies the exact file path and briefly shows a checkmark", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const path = "apps/web/src/a file with spaces.tsx";
  const { container } = render(createElement(CopyPathButton, { path }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy file path" })));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(path);
  expect(screen.getByRole("button", { name: "Copied file path" })).toBeDefined();
  expect(container.querySelector(".lucide-check")).not.toBeNull();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("button", { name: "Copy file path" })).toBeDefined();
  expect(container.querySelector(".lucide-copy")).not.toBeNull();
});

test("switching the selected file resets feedback and copies the new path", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { rerender } = render(createElement(CopyPathButton, { key: "old", path: "src/old.ts" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));
  await screen.findByRole("button", { name: "Copied file path" });
  rerender(createElement(CopyPathButton, { key: "new", path: "src/new.ts" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));
  await screen.findByRole("button", { name: "Copied file path" });
  expect(writeText.mock.calls).toEqual([["src/old.ts"], ["src/new.ts"]]);
});

test.each([true, false])("reports clipboard errors without claiming success (API available: %s)", async (available) => {
  const error = new Error("Clipboard access denied");
  vi.stubGlobal("navigator", available ? { clipboard: { writeText: vi.fn().mockRejectedValue(error) } } : {});
  render(createElement(CopyPathButton, { path: "src/main.ts" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy file path" })));
  expect(toast.error).toHaveBeenCalledWith("Could not copy file path", { description: expect.any(String) });
  expect(screen.queryByRole("button", { name: "Copied file path" })).toBeNull();
});
