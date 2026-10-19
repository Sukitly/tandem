// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PreviewView } from "../src/preview/preview-view.tsx";

const mock = vi.hoisted(() => ({
  state: { ports: [] as { port: number; label?: string; detectedAt: number }[] },
  register: vi.fn().mockResolvedValue(undefined),
  unregister: vi.fn().mockResolvedValue(undefined),
  reportFailure: vi.fn(),
}));

vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    preview: {
      state: mock.state,
      register: mock.register,
      unregister: mock.unregister,
    },
  }),
}));

vi.mock("../src/lib/errors.ts", () => ({ reportFailure: mock.reportFailure }));

vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: () => mock.state,
}));

describe("PreviewView", () => {
  beforeEach(() => {
    mock.state = { ports: [] };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders empty state when no ports are registered", () => {
    render(createElement(PreviewView, { active: true }));
    expect(screen.getByText("No preview available")).toBeDefined();
    expect(screen.getByPlaceholderText("e.g. 3000, 5173")).toBeDefined();
  });

  test("submits manual port registration", async () => {
    render(createElement(PreviewView, { active: true }));
    const input = screen.getByPlaceholderText("e.g. 3000, 5173");
    fireEvent.change(input, { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add port" }));

    expect(mock.register).toHaveBeenCalledWith({ port: 3000 }, expect.anything());
  });

  test("renders iframe for active port", () => {
    mock.state = {
      ports: [
        { port: 5173, label: "Vite", detectedAt: Date.now() },
        { port: 8080, detectedAt: Date.now() },
      ],
    };

    render(createElement(PreviewView, { active: true }));

    expect(screen.getByText("5173 (Vite)")).toBeDefined();
    expect(screen.getByText("8080")).toBeDefined();

    const iframe = screen.getByTitle("Preview port 5173") as HTMLIFrameElement;
    expect(iframe).toBeDefined();
    expect(iframe.src).toContain("/preview/5173/");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts");
  });

  test("closes active port", () => {
    mock.state = {
      ports: [{ port: 5173, label: "Vite", detectedAt: Date.now() }],
    };

    render(createElement(PreviewView, { active: true }));
    fireEvent.click(screen.getByRole("button", { name: "Close port 5173" }));
    expect(mock.unregister).toHaveBeenCalledWith({ port: 5173 }, expect.anything());
  });

  test("creates frames lazily and retains each visited port until it is removed", () => {
    mock.state = {
      ports: [
        { port: 5173, detectedAt: 0 },
        { port: 8080, detectedAt: 0 },
      ],
    };
    const view = render(createElement(PreviewView, { active: false }));
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    view.rerender(createElement(PreviewView, { active: true }));
    const first = screen.getByTitle("Preview port 5173");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "8080" }));
    const second = screen.getByTitle("Preview port 8080");
    expect(screen.getByTitle("Preview port 5173")).toBe(first);
    expect(first.parentElement?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
    expect(screen.getByTitle("Preview port 8080")).not.toBe(second);
    expect(screen.getByTitle("Preview port 5173")).toBe(first);
    fireEvent.click(screen.getByRole("tab", { name: "5173" }));
    view.rerender(createElement(PreviewView, { active: false }));
    view.rerender(createElement(PreviewView, { active: true }));
    expect(screen.getByTitle("Preview port 5173")).toBe(first);
    mock.state = { ports: [{ port: 8080, detectedAt: 0 }] };
    view.rerender(createElement(PreviewView, { active: true }));
    expect(screen.queryByTitle("Preview port 5173")).toBeNull();
  });
});
