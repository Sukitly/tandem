// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { TranscriptItem } from "../src/chat/transcript.ts";
import { ChatError, TranscriptEntry } from "../src/chat/transcript-items.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a failure is a compact collapsed trace event with error status styling", () => {
  const { container } = render(createElement(ChatError, { error: "WebSocket error" }));
  const trigger = screen.getByRole("button", { name: /Generation failed.*WebSocket error/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("[data-slot=trace]")).not.toBeNull();
  expect(container.querySelector("[data-slot=trace-line]")?.getAttribute("data-status")).toBe("error");
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).not.toMatch(/Retrying|Reconnecting/);
});

test("expanding shows complete plain-text details, attempt count, and copies the raw error", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const error = "WebSocket error\n<script>alert(1)</script>\n[Details](javascript:alert(1))";
  const { container } = render(createElement(ChatError, { error, attempts: 3 }));
  expect(screen.queryByText("3 attempts")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Generation failed/ }));
  await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe(error));
  expect(screen.getByText("3 attempts")).toBeDefined();
  expect(container.querySelector("script, a")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(error));
});

test("long summaries stay compact while the expanded details remain complete", async () => {
  const error = "x".repeat(500);
  const { container } = render(createElement(ChatError, { error }));
  expect(container.querySelector("[data-slot=trace-title]")?.textContent).toBe(`· ${"x".repeat(120)}…`);
  fireEvent.click(screen.getByRole("button", { name: /Generation failed/ }));
  await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe(error));
});

test("historical failures preserve error status styling without claiming the retry succeeded", () => {
  const item: TranscriptItem = {
    kind: "assistant",
    key: "failed",
    parts: [],
    ending: "failed",
    error: "WebSocket error",
    continued: true,
  };
  const { container } = render(createElement(TranscriptEntry, { item }));
  expect(container.querySelector("[data-historical=true]")).not.toBeNull();
  expect(container.querySelector("[data-slot=trace-line]")?.getAttribute("data-status")).toBe("error");
  expect(screen.getByText("Generation failed")).toBeDefined();
  expect(container.textContent).not.toMatch(/Recovered|Retrying|Reconnecting/);
});

test("a failure without details remains visible without an empty expand control", () => {
  render(createElement(ChatError));
  expect(screen.getByText("Generation failed")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
});

test("attempt counts can be inspected even when the provider omitted an error message", async () => {
  render(createElement(ChatError, { attempts: 2 }));
  fireEvent.click(screen.getByRole("button", { name: "Generation failed" }));
  expect(await screen.findByText("2 attempts")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
});

test("conversation notices share the trace treatment and preserve their title", () => {
  const { container } = render(createElement(ChatError, { title: "Notice", error: "A server notice" }));
  expect(screen.getByRole("button", { name: /Notice.*A server notice/ })).toBeDefined();
  expect(container.querySelector("[data-slot=trace]")).not.toBeNull();
});
