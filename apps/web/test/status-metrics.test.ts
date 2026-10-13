// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { TpsLine } from "../src/chat/tps-line.tsx";
import { UsageText } from "../src/chat/usage-line.tsx";

afterEach(cleanup);

test("quota windows use accessible progress bars rather than terminal glyphs", () => {
  render(
    createElement(UsageText, {
      usage: {
        provider: "anthropic",
        windows: [{ label: "7d", utilization: 42, windowSeconds: 604800 }],
      },
    }),
  );
  const progress = screen.getByRole("progressbar", { name: "7d quota used" });
  expect(progress.getAttribute("aria-valuenow")).toBe("42");
  expect(screen.getByText("42%")).toBeDefined();
});

test("run metrics preserve the server values and omit cache hit without prompt tokens", () => {
  render(
    createElement(TpsLine, {
      tps: {
        tokensPerSecond: 33.2,
        seconds: 6,
        inputTokens: 0,
        outputTokens: 200,
        totalTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    }),
  );
  expect(screen.getByText("33.2 tok/s")).toBeDefined();
  expect(screen.getByText("6.0s")).toBeDefined();
  expect(screen.getByText("out 200")).toBeDefined();
  expect(screen.queryByText(/cache hit/)).toBeNull();
});
