import type { DiagramPlugin } from "streamdown";
import { expect, test, vi } from "vitest";
import { lazyMermaidFrom } from "../src/chat/lazy-mermaid.ts";

function real() {
  const render = vi.fn(async (id: string, source: string) => ({ svg: `<svg data-id="${id}">${source}</svg>` }));
  const getMermaid = vi.fn((_config?: unknown) => ({ initialize: vi.fn(), render }));
  const mermaid = { name: "mermaid", type: "diagram", language: "mermaid", getMermaid } as DiagramPlugin;
  return { render, getMermaid, mermaid };
}

test("mermaid is not loaded until a diagram is drawn", async () => {
  const { mermaid } = real();
  const load = vi.fn(async () => ({ mermaid }));
  const plugin = lazyMermaidFrom(load);
  const instance = plugin.getMermaid({ theme: "dark" });
  expect(plugin).toMatchObject({ name: "mermaid", type: "diagram", language: "mermaid" });
  expect(load).not.toHaveBeenCalled();

  expect((await instance.render("id-1", "graph TD; A-->B")).svg).toContain("graph TD; A-->B");
  expect(load).toHaveBeenCalledOnce();
});

test("a diagram is drawn with the configuration it was asked with, and mermaid is loaded once for all of them", async () => {
  const { mermaid, getMermaid } = real();
  const load = vi.fn(async () => ({ mermaid }));
  const plugin = lazyMermaidFrom(load);
  await plugin.getMermaid({ theme: "dark" }).render("a", "one");
  await plugin.getMermaid({ theme: "forest" }).render("b", "two");
  expect(getMermaid.mock.calls.map(([config]) => config)).toEqual([{ theme: "dark" }, { theme: "forest" }]);
  expect(load).toHaveBeenCalledOnce();
});

test("a script that failed to load is asked for again by the next diagram", async () => {
  const { mermaid } = real();
  const load = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch the script")).mockResolvedValue({ mermaid });
  const plugin = lazyMermaidFrom(load);
  await expect(plugin.getMermaid().render("a", "one")).rejects.toThrow("Failed to fetch the script");
  expect((await plugin.getMermaid().render("b", "two")).svg).toContain("two");
  expect(load).toHaveBeenCalledTimes(2);
});
