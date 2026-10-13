// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { ContextRing } from "../src/chat/context-ring.tsx";

afterEach(cleanup);

test("the context ring exposes the percentage and exact token counts", async () => {
  render(createElement(ContextRing, { percent: 22, tokens: 59840, capacity: 272000 }));
  expect(screen.getByRole("progressbar", { name: "Context used" }).getAttribute("aria-valuenow")).toBe("22");
  fireEvent.focus(screen.getByRole("button", { name: "Context usage details" }));
  expect(await screen.findByText("59,840 / 272,000 tokens · 22% of context used")).toBeDefined();
});

test("the context ring clamps its display to a full circle", () => {
  render(createElement(ContextRing, { percent: 120, tokens: 120, capacity: 100 }));
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
});
