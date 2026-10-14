import { createConnection } from "node:net";
import { type Context, type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PreviewState, RegisterPortInput, UnregisterPortInput } from "@tandem/contracts";
import { invalidInput } from "./errors.ts";

export interface PreviewBoardOptions {
  /** Ports that must never be added to preview (such as Tandem's own port). */
  ignoredPorts?: readonly number[];
  /** Health check interval in ms. Pass 0 to disable automatic checks. */
  checkIntervalMs?: number;
}

/**
 * Manages active application preview ports.
 */
export class PreviewBoard {
  readonly #state: MutableReplicatedState<PreviewState> = replicatedState<PreviewState>({ ports: [] });
  readonly #ignoredPorts: Set<number>;
  readonly #failureCounts = new Map<number, number>();
  readonly #timer?: ReturnType<typeof setInterval>;
  #disposed = false;

  constructor(options: PreviewBoardOptions = {}) {
    this.#ignoredPorts = new Set(options.ignoredPorts ?? []);
    const interval = options.checkIntervalMs ?? 5_000;
    if (interval > 0) {
      this.#timer = setInterval(() => {
        void this.#checkPorts();
      }, interval);
      this.#timer.unref();
    }
  }

  get state(): MutableReplicatedState<PreviewState> {
    return this.#state;
  }

  ignorePort(port: number): void {
    this.#ignoredPorts.add(port);
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.ports = draft.ports.filter((entry) => entry.port !== port);
    });
  }

  async register(input: RegisterPortInput, _context?: Context): Promise<void> {
    if (this.#disposed) return;
    const port = input?.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw invalidInput(`Invalid port number: ${String(port)}`);
    }
    if (this.#ignoredPorts.has(port)) {
      return;
    }
    const label = typeof input.label === "string" ? input.label.trim().slice(0, 50) : undefined;
    const detectedAt = Date.now();

    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      const existing = draft.ports.find((entry) => entry.port === port);
      if (existing) {
        existing.detectedAt = detectedAt;
        if (label !== undefined && label.length > 0) {
          existing.label = label;
        }
      } else {
        draft.ports.push({
          port,
          detectedAt,
          ...(label !== undefined && label.length > 0 ? { label } : {}),
        });
      }
    });
    this.#failureCounts.delete(port);
  }

  async unregister(input: UnregisterPortInput, _context?: Context): Promise<void> {
    if (this.#disposed) return;
    const port = input?.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw invalidInput(`Invalid port number: ${String(port)}`);
    }
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.ports = draft.ports.filter((entry) => entry.port !== port);
    });
    this.#failureCounts.delete(port);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
    }
  }

  async #checkPorts(): Promise<void> {
    if (this.#disposed) return;
    const currentPorts = this.#state.value.ports.map((entry) => entry.port);
    for (const port of currentPorts) {
      const open = await isPortOpen(port);
      if (this.#disposed) return;
      if (open) {
        this.#failureCounts.set(port, 0);
      } else {
        const failures = (this.#failureCounts.get(port) ?? 0) + 1;
        this.#failureCounts.set(port, failures);
        // Remove after 3 consecutive failures
        if (failures >= 3) {
          this.#state.change(BACKGROUND_CONTEXT, (draft) => {
            draft.ports = draft.ports.filter((entry) => entry.port !== port);
          });
          this.#failureCounts.delete(port);
        }
      }
    }
  }
}

export function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const PORT_PATTERN = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(?<port>\d{2,5})\b/gi;

export function detectPortsFromOutput(text: string): { port: number; label?: string }[] {
  const results: { port: number; label?: string }[] = [];
  const lower = text.toLowerCase();
  let label: string | undefined;
  if (lower.includes("vite")) label = "Vite";
  else if (lower.includes("next")) label = "Next.js";
  else if (lower.includes("astro")) label = "Astro";
  else if (lower.includes("remix")) label = "Remix";
  else if (lower.includes("nuxt")) label = "Nuxt";
  else if (lower.includes("svelte")) label = "SvelteKit";
  else if (lower.includes("fastapi") || lower.includes("uvicorn")) label = "FastAPI";
  else if (lower.includes("flask")) label = "Flask";
  else if (lower.includes("django")) label = "Django";

  for (const match of text.matchAll(PORT_PATTERN)) {
    const portStr = match.groups?.port;
    if (portStr) {
      const port = Number.parseInt(portStr, 10);
      if (port >= 1024 && port <= 65535 && !results.some((r) => r.port === port)) {
        results.push({ port, label });
      }
    }
  }
  return results;
}
