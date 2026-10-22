// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { ContextUsageBadge, formatCost, formatTokens } from "../src/chat/context-usage.tsx";

afterEach(cleanup);

function badge(tokens: number, contextWindow: number, cost = 0.042) {
  return createElement(ContextUsageBadge, { usage: { tokens, cost }, contextWindow });
}

test("the context button shows the percentage and the size of the window", () => {
  render(badge(59840, 272000));
  expect(screen.getByRole("button", { name: "22% of 272K" })).toBeDefined();
});

test("context details can be opened by click instead of hover", async () => {
  render(badge(500, 1000, 0.05));
  fireEvent.click(screen.getByRole("button", { name: "50% of 1K" }));
  expect(await screen.findByText("Context window")).toBeDefined();
  expect(screen.getByText("Total cost")).toBeDefined();
  expect(screen.getByText("of 1K tokens")).toBeDefined();
  expect(screen.getByRole("img", { name: "500 of 1K used" })).toBeDefined();
});

test("the context button clamps its percentage to 100", () => {
  render(badge(120000, 100000));
  expect(screen.getByRole("button", { name: "100% of 100K" })).toBeDefined();
});

test("nothing is shown while the size of the window is not known", () => {
  const { container } = render(badge(500, 0));
  expect(container.textContent).toBe("");
});

test("status bar formats costs with appropriate precision", () => {
  expect(formatCost(0)).toBe("$0.000");
  expect(formatCost(0.042)).toBe("$0.042");
  expect(formatCost(1.5)).toBe("$1.50");
  expect(formatCost(12.345)).toBe("$12.35");
});

test("status bar formats token counts into short English figures", () => {
  expect(formatTokens(500)).toBe("500");
  expect(formatTokens(59840)).toBe("59.8K");
  expect(formatTokens(272000)).toBe("272K");
  expect(formatTokens(1_000_000)).toBe("1M");
  expect(formatTokens(1_500_000)).toBe("1.5M");
});
