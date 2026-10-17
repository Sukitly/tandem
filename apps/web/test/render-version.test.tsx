// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useRenderVersion } from "../src/hooks/use-render-version.ts";

afterEach(cleanup);
test("versions track payload inputs, not unrelated renders or text length", () => {
  const placed: unknown[] = [];
  const hook = renderHook(
    ({ text, annotations, draft }: { text: string; annotations: unknown[]; draft: object | null }) =>
      useRenderVersion([text, annotations, draft]),
    { initialProps: { text: "one", annotations: placed, draft: null as object | null } },
  );
  expect(hook.result.current).toBe(0);
  hook.rerender({ text: "one", annotations: placed, draft: null });
  expect(hook.result.current).toBe(0);
  hook.rerender({ text: "two", annotations: placed, draft: null });
  expect(hook.result.current).toBe(1);
  const annotations = [{}];
  hook.rerender({ text: "two", annotations, draft: null });
  expect(hook.result.current).toBe(2);
  const draft = { line: 3 };
  hook.rerender({ text: "two", annotations, draft });
  expect(hook.result.current).toBe(3);
  hook.rerender({ text: "two", annotations, draft });
  expect(hook.result.current).toBe(3);
});
