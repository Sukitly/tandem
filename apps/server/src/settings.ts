import { randomUUID } from "node:crypto";
import type { ModelRef } from "@tandem/contracts";
import { readJsonFile, SerialQueue, writeJsonFile } from "./json-file.ts";

/** Preferences and installation facts kept in `settings.json` in the state directory. */
export interface SettingsValue {
  publicUrl?: string;
  defaultModel?: ModelRef;
  /** The thinking level new conversations start with; the model clamps it when it does not support it. */
  defaultThinkingLevel?: string;
  /** Stable ID of this installation; some providers ask for it during login. */
  deviceId?: string;
}

export class Settings {
  readonly #path: string;
  readonly #queue = new SerialQueue();
  #value: SettingsValue;

  private constructor(path: string, value: SettingsValue) {
    this.#path = path;
    this.#value = value;
  }

  static async load(path: string): Promise<Settings> {
    const stored = await readJsonFile(path);
    return new Settings(path, stored !== null && typeof stored === "object" ? (stored as SettingsValue) : {});
  }

  get value(): Readonly<SettingsValue> {
    return this.#value;
  }

  update(change: Partial<SettingsValue>): Promise<void> {
    this.#value = { ...this.#value, ...change };
    const snapshot = this.#value;
    return this.#queue.run(() => writeJsonFile(this.#path, snapshot));
  }

  /** The installation's device ID, created and saved on first use. */
  deviceId(): string {
    let id = this.#value.deviceId;
    if (id === undefined) {
      id = randomUUID();
      void this.update({ deviceId: id });
    }
    return id;
  }
}
