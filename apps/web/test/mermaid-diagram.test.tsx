// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lazy, MermaidDiagram } from "../src/chat/mermaid-diagram.tsx";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => ({ svg: `<svg data-source="${source}"></svg>` })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

beforeEach(() => mermaid.render.mockClear());
afterEach(cleanup);

const source = (
  <pre>
    <code>the source</code>
  </pre>
);
const drawn = () => document.querySelector("svg[data-source]");

// The first of these runs before mermaid has been loaded, which is what it asserts about.
test("mermaid is loaded when the first diagram is drawn, in strict mode and once for all of them", async () => {
  expect(mermaid.initialize).not.toHaveBeenCalled();
  render(<MermaidDiagram code="graph TD; A-->B" streaming={false} fallback={source} />);
  await waitFor(() => expect(drawn()).not.toBeNull());
  expect(mermaid.initialize).toHaveBeenCalledOnce();
  expect(mermaid.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true }),
  );
  render(<MermaidDiagram code="graph TD; C-->D" streaming={false} fallback={source} />);
  await waitFor(() => expect(document.querySelectorAll("svg[data-source]")).toHaveLength(2));
  expect(mermaid.initialize).toHaveBeenCalledOnce();
});

test("a diagram is drawn from its source, with an id that is a selector, in the place of the source", async () => {
  render(<MermaidDiagram code="graph TD; A-->B" streaming={false} fallback={source} />);
  expect(screen.getByText("the source")).toBeDefined();
  await waitFor(() => expect(drawn()).not.toBeNull());
  expect(drawn()?.getAttribute("data-source")).toBe("graph TD; A-->B");
  expect(mermaid.render).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/^mermaid-diagram-\d+$/),
    "graph TD; A-->B",
  );
  expect(screen.queryByText("the source")).toBeNull();
});

test("while the text arrives it is the source, and a half-written diagram is drawn once, when it is whole", async () => {
  const { rerender } = render(<MermaidDiagram code="graph" streaming fallback={source} />);
  for (const code of ["graph TD", "graph TD; A--", "graph TD; A-->B"]) {
    rerender(<MermaidDiagram code={code} streaming fallback={source} />);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mermaid.render).not.toHaveBeenCalled();
  expect(screen.getByText("the source")).toBeDefined();
  rerender(<MermaidDiagram code="graph TD; A-->B" streaming={false} fallback={source} />);
  await waitFor(() => expect(drawn()).not.toBeNull());
  expect(mermaid.render).toHaveBeenCalledOnce();
});

test("a changed source is drawn again, and what was drawn for the old one is not shown for the new", async () => {
  const { rerender } = render(<MermaidDiagram code="one" streaming={false} fallback={source} />);
  await waitFor(() => expect(drawn()?.getAttribute("data-source")).toBe("one"));
  rerender(<MermaidDiagram code="two" streaming={false} fallback={source} />);
  expect(drawn()).toBeNull();
  await waitFor(() => expect(drawn()?.getAttribute("data-source")).toBe("two"));
});

test("a diagram that cannot be drawn stays the source, with what mermaid said under it", async () => {
  mermaid.render.mockRejectedValueOnce(new Error("Parse error on line 2"));
  render(<MermaidDiagram code="invalid" streaming={false} fallback={source} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Could not draw the diagram: Parse error on line 2");
  expect(screen.getByText("the source")).toBeDefined();
  expect(drawn()).toBeNull();
});

test("a load is made once, and a load that failed is asked for again", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch the script")).mockResolvedValue("loaded");
  const loadOnce = lazy(load);
  expect(load).not.toHaveBeenCalled();
  await expect(loadOnce()).rejects.toThrow("Failed to fetch the script");
  expect(await loadOnce()).toBe("loaded");
  expect(await loadOnce()).toBe("loaded");
  expect(load).toHaveBeenCalledTimes(2);
});
