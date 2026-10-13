import { describe, expect, test, vi } from "vitest";
import { type DevChild, runChild, type SupervisedProcess, terminate } from "../src/dev-children.ts";

/** A stand-in for a child process: `terminate` signals only a process with a pid, so nothing here touches the machine. */
function fake(options: { signal?: NodeJS.Signals; code?: number; exited?: Promise<number | null> } = {}): DevChild {
  const process: SupervisedProcess = {
    pid: undefined,
    exitCode: options.signal === undefined ? (options.code ?? 0) : null,
    signalCode: options.signal ?? null,
    kill: () => true,
  };
  return { label: "web", process, exited: options.exited ?? Promise.resolve(process.exitCode) };
}

const settled = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]);

describe("ending the development processes", () => {
  test("a process that a signal already ended does not stall the wait", async () => {
    const onError = vi.fn();
    expect(await settled(terminate([fake({ signal: "SIGTERM" })], onError))).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
  test("a process that is still running is waited for", async () => {
    let gone: (code: number | null) => void = () => {};
    const child = fake({ exited: new Promise((resolve) => (gone = resolve)) });
    const ended = terminate([child], vi.fn());
    expect(await settled(ended)).toBe(false);
    gone(0);
    expect(await settled(ended)).toBe(true);
  });
  test("each process is ended once, and the second wait returns", async () => {
    const child = fake({ code: 0 });
    await terminate([child], vi.fn());
    expect(await settled(terminate([child], vi.fn()))).toBe(true);
  });
});

describe("supervising a development process", () => {
  test("its exit is known even when a signal ends it, and its output arrives line by line", async () => {
    const lines: string[] = [];
    const exits: (number | null)[] = [];
    const child = runChild("web", "/bin/sh", ["-c", "echo hello; kill -TERM $$"], {
      cwd: process.cwd(),
      env: process.env,
      onLine: (line) => lines.push(line),
      onError: (error) => {
        throw error;
      },
      onExit: (code) => exits.push(code),
    });
    expect(await child.exited).toBeNull();
    expect(lines).toContain("hello");
    expect(exits).toEqual([null]);
    expect(await settled(terminate([child], vi.fn()))).toBe(true);
  });
});
