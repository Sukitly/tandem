import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TerminalConnection, type TerminalScreen } from "../src/terminal-connection.ts";

/** A WebSocket's shape, driven by the test. */
class FakeSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readonly url: string;
  readyState = 0;
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
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
  drop(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  /** Bytes sent, as binary frames. */
  bytes(): Uint8Array[] {
    return this.sent.filter((data): data is Uint8Array => typeof data !== "string");
  }
}

function recorder(): TerminalScreen & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    write: (data: Uint8Array | string) =>
      calls.push(`write ${typeof data === "string" ? data : new TextDecoder().decode(data)}`),
    reset: () => calls.push("reset"),
    resize: (cols: number, rows: number) => calls.push(`resize ${cols}x${rows}`),
  };
}

describe("a terminal's connection", () => {
  let sockets: FakeSocket[];
  let links: string[];
  let errors: Error[];
  const make = () => {
    const screen = recorder();
    const connection = new TerminalConnection({
      baseUrl: new URL("http://127.0.0.1:5173"),
      token: "secret",
      id: "a b",
      screen,
      onLink: (link) => links.push(link),
      onError: (error) => errors.push(error),
      socket: (url: string) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    return { screen, connection };
  };
  const socket = (index: number): FakeSocket => sockets[index] as FakeSocket;

  beforeEach(() => {
    sockets = [];
    links = [];
    errors = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("keeps credentials out of the URL, and draws the screen before the output", () => {
    const { screen, connection } = make();
    expect(socket(0).url).toBe("ws://127.0.0.1:5173/pty/a%20b");
    connection.resize({ cols: 100, rows: 30 });
    socket(0).open();
    expect(socket(0).sent).toEqual([JSON.stringify({ type: "resize", cols: 100, rows: 30 })]);

    socket(0).receive(JSON.stringify({ type: "screen", data: "$ ls", cols: 80, rows: 24 }));
    socket(0).receive(new TextEncoder().encode("\r\nREADME.md"));
    expect(screen.calls).toEqual(["reset", "resize 80x24", "write $ ls", "write \r\nREADME.md"]);
    // The page's size goes again after the screen, for the shell to draw at it.
    expect(socket(0).sent.at(-1)).toBe(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
  });

  test("sends typed text as UTF-8, and binary input byte for byte", () => {
    const { connection } = make();
    socket(0).open();
    connection.input("é\r");
    connection.inputBinary("\x1b[M\x80\xff");
    expect(
      socket(0)
        .bytes()
        .map((bytes) => [...bytes]),
    ).toEqual([
      [0xc3, 0xa9, 0x0d],
      [0x1b, 0x5b, 0x4d, 0x80, 0xff],
    ]);
  });

  test("sends a large paste in pieces the server accepts, unchanged", () => {
    const { connection } = make();
    socket(0).open();
    const paste = "x".repeat(200 * 1024);
    connection.input(paste);
    const pieces = socket(0).bytes();
    expect(pieces.length).toBe(4);
    expect(Math.max(...pieces.map((piece) => piece.length))).toBe(64 * 1024);
    expect(pieces.map((piece) => new TextDecoder().decode(piece)).join("")).toBe(paste);
  });

  test("connects again after a drop, and is redrawn from the screen", () => {
    const { screen } = make();
    socket(0).open();
    socket(0).receive(JSON.stringify({ type: "screen", data: "one", cols: 80, rows: 24 }));
    socket(0).drop(1006);
    expect(links.at(-1)).toBe("connecting");
    vi.advanceTimersByTime(300);
    expect(sockets).toHaveLength(2);
    socket(1).open();
    socket(1).receive(JSON.stringify({ type: "screen", data: "one two", cols: 80, rows: 24 }));
    expect(screen.calls.filter((call) => call === "reset")).toHaveLength(2);
    expect(screen.calls.at(-1)).toBe("write one two");
  });

  test("stays closed when the terminal is gone, until asked to connect again", () => {
    const { connection } = make();
    socket(0).open();
    socket(0).drop(1000);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(links.at(-1)).toBe("closed");
    expect(errors).toEqual([]);
    connection.reconnect();
    expect(sockets).toHaveLength(2);
  });

  test("reports a message the server refused as the page's fault, and stays closed", () => {
    make();
    socket(0).open();
    socket(0).drop(1003, "Unknown control message");
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(links.at(-1)).toBe("closed");
    expect(errors.map((error) => error.message)).toEqual(["The terminal refused a message: Unknown control message"]);
  });

  test("does not connect again once the page closed it", () => {
    const { connection } = make();
    connection.close();
    socket(0).drop(1006);
    vi.advanceTimersByTime(10_000);
    connection.reconnect();
    expect(sockets).toHaveLength(1);
  });
});
