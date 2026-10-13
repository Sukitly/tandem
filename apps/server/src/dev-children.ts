import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** What supervising one development process needs of it: enough to end it, and to know that it is gone. */
export interface SupervisedProcess {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface DevChild {
  readonly label: string;
  readonly process: SupervisedProcess;
  /**
   * Resolves once the process is gone, whether it exited or a signal ended it. It is settled from the moment the
   * process starts: a process already gone will never emit `exit` again, so waiting for that event later hangs.
   */
  readonly exited: Promise<number | null>;
}

export interface RunChildOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** One line of the child's output, without its trailing newline. */
  onLine(line: string): void;
  onError(error: Error): void;
  onExit(code: number | null): void;
}

export function runChild(label: string, command: string, args: string[], options: RunChildOptions): DevChild {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    // Its own process group, so that everything the child starts is ended with it.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let settle: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => {
    settle = resolve;
  });
  for (const stream of [child.stdout, child.stderr])
    if (stream !== null) createInterface({ input: stream }).on("line", (line) => options.onLine(line));
  child.once("error", options.onError);
  child.once("exit", (code) => {
    settle(code);
    options.onExit(code);
  });
  return { label, process: child, exited };
}

/** Ends every process group and waits until each process is gone. Ready to be awaited again after one has ended. */
export async function terminate(children: readonly DevChild[], onError: (error: Error) => void): Promise<void> {
  for (const child of children) {
    const pid = child.process.pid;
    if (pid === undefined) continue;
    try {
      if (process.platform === "win32") child.process.kill("SIGTERM");
      else process.kill(-pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") onError(error as Error);
    }
  }
  await Promise.all(children.map((child) => child.exited));
}
