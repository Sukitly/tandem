import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TerminalConnection, type TerminalScreen } from "../src/terminals/terminal-connection.ts";

/** A browser WebSocket's shape, driven by the test. */
class FakeSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: string | Uint8Array): void {
    this.onmessage?.({ data: typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer) });
  }
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function recorder(): TerminalScreen & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    write: (data) => calls.push(`write ${typeof data === "string" ? data : new TextDecoder().decode(data)}`),
    reset: () => calls.push("reset"),
    resize: (cols, rows) => calls.push(`resize ${cols}x${rows}`),
  };
}

describe("a terminal's connection", () => {
  let sockets: FakeSocket[];
  const make = () => {
    const screen = recorder();
    const connection = new TerminalConnection({
      origin: "http://127.0.0.1:5173",
      token: "secret",
      id: "a b",
      screen,
      socket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    return { screen, connection };
  };

  beforeEach(() => {
    sockets = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("connects beside the page with the token, and draws the screen before the output", () => {
    const { screen, connection } = make();
    expect(sockets[0]?.url).toBe("ws://127.0.0.1:5173/pty/a%20b?token=secret");
    connection.resize({ cols: 100, rows: 30 });
    sockets[0]?.open();
    expect(sockets[0]?.sent).toEqual([JSON.stringify({ type: "resize", cols: 100, rows: 30 })]);

    sockets[0]?.receive(JSON.stringify({ type: "screen", data: "$ ls", cols: 80, rows: 24 }));
    sockets[0]?.receive(new TextEncoder().encode("\r\nREADME.md"));
    expect(screen.calls).toEqual(["reset", "resize 80x24", "write $ ls", "write \r\nREADME.md"]);
    // The page's size goes again after the screen, for the shell to draw at it.
    expect(sockets[0]?.sent.at(-1)).toBe(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));

    connection.input("é\r");
    expect(new TextDecoder().decode(sockets[0]?.sent.at(-1) as Uint8Array)).toBe("é\r");
  });

  test("connects again after a drop, and is redrawn from the screen", () => {
    const { screen } = make();
    sockets[0]?.open();
    sockets[0]?.receive(JSON.stringify({ type: "screen", data: "one", cols: 80, rows: 24 }));
    sockets[0]?.drop(1006);
    vi.advanceTimersByTime(300);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    sockets[1]?.receive(JSON.stringify({ type: "screen", data: "one two", cols: 80, rows: 24 }));
    expect(screen.calls.filter((call) => call === "reset")).toHaveLength(2);
    expect(screen.calls.at(-1)).toBe("write one two");
  });

  test("stays closed when the server closes it, or the page does", () => {
    const first = make();
    sockets[0]?.open();
    sockets[0]?.drop(1000);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);

    const second = make();
    second.connection.close();
    sockets[1]?.drop(1006);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
    expect(first.screen.calls).toEqual([]);
  });
});
