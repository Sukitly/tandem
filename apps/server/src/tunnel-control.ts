import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { type TunnelIdentity, type TunnelState, tunnelTokenIdentity } from "@tandem/contracts";
import { CLOUDFLARED, cloudflaredMissing } from "./cloudflared.ts";
import { defaultStateDirPath } from "./state-dir.ts";
import { loadTunnelConfig, saveTunnelConfig, type TunnelConfig, tunnelConfigPath } from "./tunnel-config.ts";
import { localTunnelIdentity, tunnelFileYamlPath } from "./tunnel-file.ts";
import { startTunnel, type TunnelRunner } from "./tunnel-runner.ts";
import { setupTunnel } from "./tunnel-setup.ts";

/** What a page is shown about publishing this machine, and what `/health` reports about the tunnel itself. */
export interface PublicAccessView {
  readonly status: "none" | "authorizing" | "starting" | TunnelState;
  readonly publicUrl?: string;
  readonly authorizationUrl?: string;
  readonly message?: string;
  /** The tunnel that is configured, when it can be told, for a page to link to its dashboard. */
  readonly tunnel?: TunnelIdentity;
}

/**
 * Owns the tunnel for the life of the server: one tunnel process, the configuration behind it, and what a page is
 * told about either. Publishing is slow and partly interactive, so it runs on its own and reports through here
 * rather than making a caller wait.
 */
export class TunnelControl {
  readonly #stateDir: string;
  readonly #executable: string;
  readonly #onLog: (line: string) => void;
  readonly #listeners = new Set<(view: PublicAccessView) => void>();
  #view: PublicAccessView = { status: "none" };
  #config: TunnelConfig | undefined;
  #runner: TunnelRunner | undefined;
  #working: Promise<void> | undefined;

  constructor(options: { stateDir?: string; executable?: string; onLog: (line: string) => void }) {
    this.#stateDir = options.stateDir ?? defaultStateDirPath();
    this.#executable = options.executable ?? CLOUDFLARED;
    this.#onLog = options.onLog;
  }

  get view(): PublicAccessView {
    return this.#view;
  }

  /** Whether `cloudflared` is on this machine, which the page says plainly rather than failing later. */
  get cloudflared(): boolean {
    return !cloudflaredMissing(this.#executable);
  }

  /** What `/health` reports. */
  tunnelState(): TunnelState | undefined {
    const status = this.#view.status;
    return status === "none" || status === "authorizing" ? undefined : status;
  }

  onChange(listener: (view: PublicAccessView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts what is already configured, at server startup. */
  async resume(): Promise<void> {
    this.#config = await loadTunnelConfig(this.#stateDir);
    if (this.#config === undefined) return;
    this.#start(this.#config);
  }

  /** Publishes at that origin. Returns once the work has started; the view carries what happens next. */
  async publish(input: { publicUrl: string; token?: string }): Promise<void> {
    if (this.#working !== undefined) throw new Error("A tunnel is already being set up");
    const work = this.#publish(input).finally(() => {
      this.#working = undefined;
    });
    this.#working = work;
  }

  /** Stops the tunnel here. What Cloudflare holds stays, so publishing again needs no authorization. */
  async unpublish(): Promise<void> {
    await this.#stopRunner();
    await rm(tunnelFileYamlPath(this.#stateDir), { force: true });
    await rm(tunnelConfigPath(this.#stateDir), { force: true });
    this.#config = undefined;
    this.#report({ status: "none" });
  }

  async stop(): Promise<void> {
    await this.#working?.catch(() => {});
    await this.#stopRunner();
  }

  async #publish(input: { publicUrl: string; token?: string }): Promise<void> {
    const { publicUrl } = input;
    this.#report({ status: input.token === undefined ? "authorizing" : "starting", publicUrl });
    try {
      if (input.token === undefined) await this.#authorize(publicUrl);
      else await this.#adopt(input.token, publicUrl);
      const config = await loadTunnelConfig(this.#stateDir);
      if (config === undefined) throw new Error("The tunnel configuration was not written");
      this.#config = config;
      this.#start(config);
    } catch (error) {
      this.#report({ status: "failed", publicUrl, message: message(error) });
    }
  }

  /** A tunnel this machine manages itself: authorize it, create it, and point the hostname at it. */
  async #authorize(publicUrl: string): Promise<void> {
    if (!this.cloudflared)
      throw new Error(`${this.#executable} is not installed. Install it with \`brew install cloudflared\`.`);
    await setupTunnel({
      publicUrl,
      stateDir: this.#stateDir,
      executable: this.#executable,
      report: (line) => this.#onLog(line),
      onAuthorizationUrl: (url) => this.#report({ status: "authorizing", publicUrl, authorizationUrl: url }),
    });
  }

  /**
   * A tunnel a dashboard describes: its token runs that one tunnel and grants nothing else, which is what a machine
   * that is not this person's own should hold. The file a self-managed tunnel reads would win over the token, so
   * choosing this route replaces it.
   */
  async #adopt(token: string, publicUrl: string): Promise<void> {
    const managed = tunnelFileYamlPath(this.#stateDir);
    if (existsSync(managed)) {
      await rm(managed, { force: true });
      this.#onLog(`Replaced ${managed} with the tunnel token.`);
    }
    await saveTunnelConfig({ publicUrl, token }, this.#stateDir);
  }

  #start(config: TunnelConfig): void {
    void Promise.all([this.#stopRunner(), this.#identify(config)]).then(([, tunnel]) => {
      const known = tunnel === undefined ? {} : { tunnel };
      this.#runner = startTunnel(config, {
        stateDir: this.#stateDir,
        executable: this.#executable,
        onLog: this.#onLog,
        onState: (status) => this.#report({ status, publicUrl: config.publicUrl, ...known }),
      });
      this.#report({ status: this.#runner.state(), publicUrl: config.publicUrl, ...known });
    });
  }

  /** Which tunnel runs, read the way the runner chooses: the file this machine wrote wins over a token. */
  async #identify(config: TunnelConfig): Promise<TunnelIdentity | undefined> {
    if (existsSync(tunnelFileYamlPath(this.#stateDir))) return localTunnelIdentity(this.#stateDir);
    return config.token === undefined ? undefined : tunnelTokenIdentity(config.token);
  }

  async #stopRunner(): Promise<void> {
    const runner = this.#runner;
    this.#runner = undefined;
    await runner?.stop();
  }

  #report(view: PublicAccessView): void {
    this.#view = view;
    for (const listener of this.#listeners) listener(view);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
