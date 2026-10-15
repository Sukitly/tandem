// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { formatCost, formatTokens } from "../src/chat/status-bar.tsx";
import { Context } from "../src/components/ai-elements/context.tsx";

afterEach(cleanup);

test("the context AI element exposes the percentage and token usage", () => {
  render(createElement(Context, { usedTokens: 59840, maxTokens: 272000, cost: 0.042 }));
  expect(screen.getByRole("button", { name: "22% context" })).toBeDefined();
});

test("the context AI element clamps its display to 100 percent", () => {
  render(createElement(Context, { usedTokens: 120000, maxTokens: 100000 }));
  expect(screen.getByRole("button", { name: "100% context" })).toBeDefined();
});

test("the context AI element exposes custom label when provided", () => {
  render(createElement(Context, { usedTokens: 108800, maxTokens: 272000, label: "40% of 272K" }));
  expect(screen.getByRole("button", { name: "40% of 272K" })).toBeDefined();
});

test("status bar formats costs with appropriate precision", () => {
  expect(formatCost(0)).toBe("$0.000");
  expect(formatCost(0.042)).toBe("$0.042");
  expect(formatCost(1.5)).toBe("$1.50");
  expect(formatCost(12.345)).toBe("$12.35");
});

test("status bar formats token counts into human readable abbreviations", () => {
  expect(formatTokens(500)).toBe("1K");
  expect(formatTokens(272000)).toBe("272K");
  expect(formatTokens(1_000_000)).toBe("1M");
  expect(formatTokens(1_500_000)).toBe("1.5M");
});
