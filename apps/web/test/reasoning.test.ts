// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { Reasoning } from "../src/components/ai-elements/reasoning.tsx";

afterEach(cleanup);

test("reasoning shows a brain instead of a checkmark when thinking finishes", () => {
  const { container, rerender } = render(createElement(Reasoning, { text: "", running: true }));
  expect(screen.getByText("Thinking")).toBeDefined();
  expect(container.querySelector("[data-slot=trace-icon] .animate-spin")).not.toBeNull();
  expect(container.querySelector(".lucide-brain")).toBeNull();

  rerender(createElement(Reasoning, { text: "", running: false }));
  expect(screen.getByText("Thought")).toBeDefined();
  expect(container.querySelector("[data-slot=trace-icon] .lucide-brain")).not.toBeNull();
  expect(container.querySelector(".lucide-check")).toBeNull();
  expect(container.querySelector(".animate-spin")).toBeNull();
});
