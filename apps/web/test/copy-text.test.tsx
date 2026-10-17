// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CodeCopyButton } from "../src/components/copy-text.tsx";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  mocks.error.mockClear();
});

test("clipboard rejection is visible and copying can be retried", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Permission denied")).mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<CodeCopyButton value="hello" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not copy", { description: "Permission denied" }));
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  expect(writeText).toHaveBeenCalledTimes(2);
});

test("missing clipboard APIs also report an actionable error", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  render(<CodeCopyButton value="hello" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy code" })));
  expect(mocks.error).toHaveBeenCalledWith("Could not copy", { description: expect.stringContaining("unavailable") });
});
