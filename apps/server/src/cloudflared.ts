import { spawn, spawnSync } from "node:child_process";

/** The program that runs a tunnel, whether a person installed it or a test stands in for it. */
export const CLOUDFLARED = "cloudflared";

/** Whether the program is on `PATH` at all. */
export function cloudflaredMissing(executable: string = CLOUDFLARED): boolean {
  return errorCode(spawnSync(executable, ["--version"], { stdio: "ignore" })) === "ENOENT";
}

export interface Captured {
  readonly ok: boolean;
  /** Standard output alone: this is where a command that prints JSON prints it. */
  readonly stdout: string;
  readonly output: string;
}

/** Runs cloudflared and captures what it printed, for the commands whose output is read rather than watched. */
export function cloudflaredCapture(executable: string, args: readonly string[]): Captured {
  const result = spawnSync(executable, [...args], { encoding: "utf8" });
  const error = errorCode(result);
  if (error !== undefined && error !== "ENOENT") throw result.error;
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Runs cloudflared with its output shown as it arrives, for the commands a person waits on: authorizing this machine
 * opens a browser, and what cloudflared says while it waits is the only progress there is.
 */
export function cloudflaredRun(
  executable: string,
  args: readonly string[],
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let killTimer: NodeJS.Timeout | undefined;
    const abort = (): void => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimer.unref();
    };
    signal?.addEventListener("abort", abort, { once: true });
    let spawnError: Error | undefined;
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        const lines = (pending + chunk).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          output += `${line}\n`;
          if (line !== "") onLine(line);
        }
      });
      stream.on("end", () => {
        if (pending !== "") onLine(pending);
      });
    }
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(killTimer);
      if (signal?.aborted) reject(signal.reason);
      else if (spawnError !== undefined) reject(spawnError);
      else if (code === 0) resolve();
      else reject(new Error(`cloudflared ${args.join(" ")} exited with ${code ?? "a signal"}\n${output.trim()}`));
    });
  });
}

function errorCode(result: { error?: Error }): string | undefined {
  return (result.error as NodeJS.ErrnoException | undefined)?.code;
}
