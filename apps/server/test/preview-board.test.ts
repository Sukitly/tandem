import { describe, expect, test } from "vitest";
import { PreviewBoard } from "../src/services/preview.ts";

describe("PreviewBoard", () => {
  test("registers and unregisters ports", async () => {
    const board = new PreviewBoard({ checkIntervalMs: 0 });
    try {
      await board.register({ port: 3000, label: "Next.js" });
      expect(board.state.value.ports).toHaveLength(1);
      expect(board.state.value.ports[0]?.port).toBe(3000);
      expect(board.state.value.ports[0]?.label).toBe("Next.js");

      await board.register({ port: 5173, label: "Vite" });
      expect(board.state.value.ports).toHaveLength(2);

      await board.unregister({ port: 3000 });
      expect(board.state.value.ports).toHaveLength(1);
      expect(board.state.value.ports[0]?.port).toBe(5173);
    } finally {
      board.dispose();
    }
  });

  test("registers port without label and avoids undefined values in state", async () => {
    const board = new PreviewBoard({ checkIntervalMs: 0 });
    try {
      await board.register({ port: 3000 });
      expect(board.state.value.ports).toHaveLength(1);
      expect("label" in (board.state.value.ports[0] ?? {})).toBe(false);
    } finally {
      board.dispose();
    }
  });

  test("rejects invalid ports", async () => {
    const board = new PreviewBoard({ checkIntervalMs: 0 });
    try {
      await expect(board.register({ port: 0 })).rejects.toThrow(/Invalid port number/);
      await expect(board.register({ port: 70000 })).rejects.toThrow(/Invalid port number/);
      await expect(board.register({ port: -1 })).rejects.toThrow(/Invalid port number/);
      await expect(board.register({ port: 3.14 })).rejects.toThrow(/Invalid port number/);
    } finally {
      board.dispose();
    }
  });

  test("ignores specified ports", async () => {
    const board = new PreviewBoard({ ignoredPorts: [4820], checkIntervalMs: 0 });
    try {
      await board.register({ port: 4820 });
      expect(board.state.value.ports).toHaveLength(0);
    } finally {
      board.dispose();
    }
  });

  test("updates label and timestamp for existing port", async () => {
    const board = new PreviewBoard({ checkIntervalMs: 0 });
    try {
      await board.register({ port: 8080, label: "Old" });
      const initial = board.state.value.ports[0]?.detectedAt;
      await new Promise((r) => setTimeout(r, 10));
      await board.register({ port: 8080, label: "New" });
      expect(board.state.value.ports).toHaveLength(1);
      expect(board.state.value.ports[0]?.label).toBe("New");
      const detected = board.state.value.ports[0]?.detectedAt;
      expect(detected).toBeDefined();
      expect(detected ?? 0).toBeGreaterThanOrEqual(initial ?? 0);
    } finally {
      board.dispose();
    }
  });
});
