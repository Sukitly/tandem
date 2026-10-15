// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { Context } from "../src/components/ai-elements/context.tsx";

afterEach(cleanup);

test("the context AI element exposes the percentage and token usage", () => {
  render(createElement(Context, { usedTokens: 59840, maxTokens: 272000 }));
  expect(screen.getByRole("button", { name: "22% context" })).toBeDefined();
});

test("the context AI element clamps its display to 100 percent", () => {
  render(createElement(Context, { usedTokens: 120000, maxTokens: 100000 }));
  expect(screen.getByRole("button", { name: "100% context" })).toBeDefined();
});
