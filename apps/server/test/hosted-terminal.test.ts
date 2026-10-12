import type { TerminalEvent } from "@tandem/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/** The pseudo-terminal the last terminal spawned: the test writes its output and sees it paused. */
const fake = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | {
        data: (chunk: Buffer) => void;
        exit: (exit: { exitCode: number; signal?: number }) => void;
        calls: string[];
      },
}));

vi.mock("node-pty", () => ({
  spawn: () => {
    const calls: string[] = [];
    const listeners = { data: (_chunk: Buffer) => {}, exit: (_exit: { exitCode: number; signal?: number }) => {} };
    fake.current = {
      data: (chunk) => listeners.data(chunk),
      exit: (exit) => listeners.exit(exit),
      calls,
    };
    return {
      onData: (listener: (chunk: Buffer) => void) => {
        listeners.data = listener;
      },
      onExit: (listener: (exit: { exitCode: number; signal?: number }) => void) => {
        listeners.exit = listener;
      },
      write: (data: Buffer) => calls.push(`write ${String(data)}`),
      resize: (cols: number, rows: number) => calls.push(`resize ${cols}x${rows}`),
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
      kill: () => calls.push("kill"),
    };
  },
}));

const { HostedTerminal } = await import("../src/hosted-terminal.ts");

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A page whose backlog the test sets. */
function peer() {
  const bytes: string[] = [];
  const events: TerminalEvent[] = [];
  return {
    bytes,
    events,
    behind: 0,
    sendBytes(data: Uint8Array) {
      bytes.push(Buffer.from(data).toString("utf8"));
    },
    sendEvent(event: TerminalEvent) {
      events.push(event);
    },
    closed: [] as number[],
    close(code: number) {
      this.closed.push(code);
    },
  };
}

const screens = (events: TerminalEvent[]): string[] =>
  events.flatMap((event) => (event.type === "screen" ? [event.data] : []));

describe("a terminal's flow", () => {
  let terminal: InstanceType<typeof HostedTerminal>;
  beforeEach(() => {
    terminal = new HostedTerminal({ id: "t", cwd: "/", size: { cols: 80, rows: 24 }, onExit: () => {} });
  });
  afterEach(() => terminal.dispose());

  test("pauses the shell while the server's screen is far behind, and resumes it", async () => {
    const shell = fake.current;
    // Two megabytes at once: more than the screen may have waiting.
    for (let index = 0; index < 32; index += 1) shell?.data(Buffer.alloc(64 * 1024, "x"));
    expect(shell?.calls).toContain("pause");
    await waitFor(() => shell?.calls.includes("resume") === true);
    expect(shell?.calls.filter((call) => call === "pause" || call === "resume")).toEqual(["pause", "resume"]);
  });

  test("sends a page that fell behind the screen again, not the bytes it missed", async () => {
    const page = peer();
    terminal.attach(page);
    await waitFor(() => screens(page.events).length === 1);
    fake.current?.data(Buffer.from("one "));
    await waitFor(() => page.bytes.join("") === "one ");

    // Too far behind: the bytes it would get stop, and it waits until it has sent what it has.
    page.behind = 5 * 1024 * 1024;
    fake.current?.data(Buffer.from("two "));
    fake.current?.data(Buffer.from("three"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(page.bytes.join("")).toBe("one ");
    expect(screens(page.events)).toHaveLength(1);

    page.behind = 0;
    await waitFor(() => screens(page.events).length === 2);
    expect(screens(page.events)[1]).toContain("one two three");
    // And live again after it.
    fake.current?.data(Buffer.from(" four"));
    await waitFor(() => page.bytes.join("").endsWith(" four"));
    expect(page.bytes.join("")).toBe("one  four");
  });

  test("closes its pages when it is disposed", async () => {
    const page = peer();
    terminal.attach(page);
    await waitFor(() => screens(page.events).length === 1);
    terminal.dispose();
    expect(page.closed).toEqual([1000]);
    expect(fake.current?.calls).toContain("kill");
  });
});
