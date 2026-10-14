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
  useOptionalConnected: () => ({
    preview: {
      state: mock.state,
      register: mock.register,
      unregister: mock.unregister,
    },
  }),
}));

vi.mock("../src/app/workbench.tsx", () => ({
  useWorkbench: () => ({
    reportFailure: mock.reportFailure,
  }),
}));

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
  });

  test("closes active port", () => {
    mock.state = {
      ports: [{ port: 5173, label: "Vite", detectedAt: Date.now() }],
    };

    render(createElement(PreviewView, { active: true }));
    fireEvent.click(screen.getByRole("button", { name: "Close port 5173" }));
    expect(mock.unregister).toHaveBeenCalledWith({ port: 5173 }, expect.anything());
  });

  test("toggles viewport mode between responsive and desktop", () => {
    mock.state = {
      ports: [{ port: 5173, label: "Vite", detectedAt: Date.now() }],
    };

    render(createElement(PreviewView, { active: true }));
    const toggleBtn = screen.getByRole("button", { name: "Responsive view" });
    fireEvent.click(toggleBtn);
    expect(screen.getByRole("button", { name: "Desktop view (1280px)" })).toBeDefined();
  });
});
