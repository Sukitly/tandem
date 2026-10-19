import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { detectPortsFromOutput, isPortOpen, PreviewBoard } from "../src/services/preview.ts";

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

  test("rejects ignored and dangerous ports", async () => {
    const board = new PreviewBoard({ ignoredPorts: [4820], checkIntervalMs: 0 });
    try {
      await expect(board.register({ port: 4820 })).rejects.toThrow(/restricted/);
      await expect(board.register({ port: 22 })).rejects.toThrow(/restricted/);
      await expect(board.register({ port: 6379 })).rejects.toThrow(/restricted/);
      expect(board.state.value.ports).toHaveLength(0);
    } finally {
      board.dispose();
    }
  });

  test("prunes dead port after consecutive health check failures", async () => {
    // Start temporary server on an ephemeral port
    const dummyServer = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => dummyServer.listen(0, "127.0.0.1", resolve));
    const port = (dummyServer.address() as AddressInfo).port;

    const board = new PreviewBoard({ checkIntervalMs: 50 });
    try {
      await board.register({ port, label: "Temporary" });
      expect(board.state.value.ports).toHaveLength(1);

      // Close the server to simulate process termination
      await new Promise<void>((resolve) => dummyServer.close(() => resolve()));

      // Wait for health check cycles (at 50ms intervals, 3 failures require ~150-250ms)
      const deadline = Date.now() + 2_000;
      while (board.state.value.ports.length > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(board.state.value.ports).toHaveLength(0);
    } finally {
      board.dispose();
    }
  });
});

describe("isPortOpen", () => {
  test("returns true for active listening port and false for inactive port", async () => {
    const dummyServer = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => dummyServer.listen(0, "127.0.0.1", resolve));
    const port = (dummyServer.address() as AddressInfo).port;

    try {
      expect(await isPortOpen(port)).toBe(true);
      expect(await isPortOpen(65431)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => dummyServer.close(() => resolve()));
    }
  });
});

describe("detectPortsFromOutput", () => {
  test("detects Vite local URL", () => {
    const output = `
  VITE v5.0.0  ready in 200 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
`;
    const detected = detectPortsFromOutput(output);
    expect(detected).toEqual([{ port: 5173, label: "Vite" }]);
  });

  test("detects Next.js local URL", () => {
    const output = "▲ Next.js 14.0.0\n- Local:        http://localhost:3000\n";
    const detected = detectPortsFromOutput(output);
    expect(detected).toEqual([{ port: 3000, label: "Next.js" }]);
  });

  test("detects Uvicorn/FastAPI URL", () => {
    const output = "INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)";
    const detected = detectPortsFromOutput(output);
    expect(detected).toEqual([{ port: 8000, label: "FastAPI" }]);
  });

  test("ignores invalid or non-port numbers", () => {
    expect(detectPortsFromOutput("Version: 1.2.3 and ratio 4:5")).toEqual([]);
    expect(detectPortsFromOutput("Listening on port 80")).toEqual([]); // below 1024
    expect(detectPortsFromOutput("Connecting to http://localhost:99999")).toEqual([]); // above 65535
  });
});
