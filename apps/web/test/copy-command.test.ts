// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { CopyCommand } from "../src/tunnel/copy-command.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("copies the exact command without surrounding instructions and reports success", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const command = "bun run tunnel setup --public-url https://tandem.example.com";
  render(createElement(CopyCommand, { command }));
  fireEvent.click(screen.getByRole("button", { name: `Copy ${command}` }));
  expect(writeText).toHaveBeenCalledWith(command);
  expect(await screen.findByText("Copied to clipboard.")).toBeDefined();
});

test("reports clipboard refusal and leaves the command available for manual copying", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  render(createElement(CopyCommand, { command: "bun run start" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy bun run start" }));
  expect(await screen.findByText("Could not copy. Select the command and copy it manually.")).toBeDefined();
  expect(screen.getByText("bun run start")).toBeDefined();
});
