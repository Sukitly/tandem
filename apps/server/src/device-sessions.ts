import { createHash, randomBytes, randomUUID } from "node:crypto";
import { replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { DeviceSummary, DevicesState, PairingCode } from "@tandem/contracts";
import { readJsonFile, SerialQueue, writeJsonFile } from "./json-file.ts";

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const PAIR_LIFETIME_MS = 5 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
type StoredDevice = DeviceSummary & { hash: string };
type Stored = { devices: StoredDevice[]; recoveryHashes: string[] };

export class PairingError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Installation credentials, independent of model credentials and pi-server Sessions. */
export class DeviceSessions {
  readonly state = replicatedState<DevicesState>({ devices: [], recoveryCodesRemaining: 0 });
  readonly #path: string | undefined;
  readonly #now: () => number;
  readonly #queue = new SerialQueue();
  readonly #codes = new Map<string, number>();
  readonly #revoked = new Set<(id: string) => void>();
  readonly #active = new Map<string, number>();
  #stored: Stored;
  #failures = 0;
  #blockedUntil = 0;

  private constructor(path: string | undefined, stored: Stored, now: () => number) {
    this.#path = path;
    this.#stored = stored;
    this.#now = now;
    this.#publish();
  }

  static async load(path?: string, now = Date.now): Promise<DeviceSessions> {
    const value = path === undefined ? undefined : await readJsonFile(path);
    if (value !== undefined && !validStored(value)) throw new Error("Invalid device credentials file");
    return new DeviceSessions(path, value ?? { devices: [], recoveryHashes: [] }, now);
  }

  issue(publicUrl?: string): PairingCode {
    const now = this.#now();
    for (const [hash, expires] of this.#codes) if (expires <= now) this.#codes.delete(hash);
    if (this.#codes.size >= 100) throw new PairingError("Too many pending pairing links. Wait five minutes.", 429);
    const code = randomBytes(16).toString("hex");
    const expiresAt = now + PAIR_LIFETIME_MS;
    this.#codes.set(digest(code), expiresAt);
    return { code, expiresAt, ...(publicUrl === undefined ? {} : { publicUrl }) };
  }

  redeem(code: string, name: string): Promise<{ secret: string; device: DeviceSummary }> {
    return this.#queue.run(async () => {
      const now = this.#now();
      if (now < this.#blockedUntil) throw new PairingError("Too many failed attempts. Try again in one minute.", 429);
      const hash = digest(normalize(code));
      const expires = this.#codes.get(hash);
      const recovery = this.#stored.recoveryHashes.indexOf(hash);
      if (!(expires !== undefined && expires > now) && recovery < 0) {
        this.#failures += 1;
        if (this.#failures >= 5) {
          this.#blockedUntil = now + 60_000;
          this.#failures = 0;
        }
        throw new PairingError("The code is invalid, expired, or already used.");
      }
      const secret = randomBytes(32).toString("base64url");
      const device: StoredDevice = { id: randomUUID(), name, createdAt: now, lastSeenAt: now, hash: digest(secret) };
      const next = {
        devices: [...this.#stored.devices, device],
        recoveryHashes: this.#stored.recoveryHashes.filter((_, index) => index !== recovery),
      };
      await this.#save(next);
      this.#codes.delete(hash);
      this.#failures = 0;
      return { secret, device: summary(device) };
    });
  }

  authenticate(secret: string | undefined): Promise<DeviceSummary | undefined> {
    return this.#queue.run(async () => {
      if (secret === undefined) return undefined;
      const device = this.#stored.devices.find((item) => item.hash === digest(secret));
      if (device === undefined) return undefined;
      const now = this.#now();
      if (!this.#active.has(device.id) && now - device.lastSeenAt >= SESSION_IDLE_MS) {
        await this.#save({ ...this.#stored, devices: this.#stored.devices.filter((item) => item.id !== device.id) });
        this.#notify(device.id);
        return undefined;
      }
      if (now - device.lastSeenAt >= TOUCH_INTERVAL_MS) {
        const next = { ...device, lastSeenAt: now };
        await this.#save({
          ...this.#stored,
          devices: this.#stored.devices.map((item) => (item.id === device.id ? next : item)),
        });
        return summary(next);
      }
      return summary(device);
    });
  }

  /** An open socket keeps a device active; releasing it records the end of that activity. */
  hold(id: string): () => Promise<void> {
    this.#active.set(id, (this.#active.get(id) ?? 0) + 1);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const count = (this.#active.get(id) ?? 1) - 1;
      if (count > 0) this.#active.set(id, count);
      else this.#active.delete(id);
      await this.#queue.run(async () => {
        if (this.#stored.devices.some((item) => item.id === id))
          await this.#save({
            ...this.#stored,
            devices: this.#stored.devices.map((item) => (item.id === id ? { ...item, lastSeenAt: this.#now() } : item)),
          });
      });
    };
  }

  onRevoke(listener: (id: string) => void): () => void {
    this.#revoked.add(listener);
    return () => this.#revoked.delete(listener);
  }

  revoke(id: string): Promise<void> {
    return this.#queue.run(async () => {
      await this.#save({ ...this.#stored, devices: this.#stored.devices.filter((item) => item.id !== id) });
      this.#notify(id);
    });
  }

  revokeOthers(keepId: string): Promise<void> {
    return this.#queue.run(async () => {
      if (!this.#stored.devices.some((item) => item.id === keepId)) throw new Error("Device does not exist");
      const removed = this.#stored.devices.filter((item) => item.id !== keepId);
      await this.#save({ ...this.#stored, devices: this.#stored.devices.filter((item) => item.id === keepId) });
      for (const device of removed) this.#notify(device.id);
    });
  }

  rename(id: string, name: string): Promise<void> {
    return this.#queue.run(async () => {
      await this.#save({
        ...this.#stored,
        devices: this.#stored.devices.map((item) => (item.id === id ? { ...item, name } : item)),
      });
    });
  }

  regenerateRecoveryCodes(): Promise<string[]> {
    return this.#queue.run(async () => {
      const codes = Array.from({ length: 10 }, () => {
        const raw = randomBytes(16).toString("hex");
        return Array.from({ length: 8 }, (_, index) => raw.slice(index * 4, index * 4 + 4)).join("-");
      });
      await this.#save({ ...this.#stored, recoveryHashes: codes.map((code) => digest(normalize(code))) });
      return codes;
    });
  }

  touchActive(): Promise<void> {
    return this.#queue.run(async () => {
      const now = this.#now();
      if (
        !this.#stored.devices.some(
          (device) => this.#active.has(device.id) && now - device.lastSeenAt >= TOUCH_INTERVAL_MS,
        )
      )
        return;
      await this.#save({
        ...this.#stored,
        devices: this.#stored.devices.map((device) =>
          this.#active.has(device.id) ? { ...device, lastSeenAt: now } : device,
        ),
      });
    });
  }

  async flush(): Promise<void> {
    await this.#queue.run(async () => {});
  }

  #notify(id: string): void {
    this.#active.delete(id);
    for (const listener of this.#revoked) listener(id);
  }

  async #save(next: Stored): Promise<void> {
    if (this.#path !== undefined) await writeJsonFile(this.#path, next);
    this.#stored = next;
    this.#publish();
  }

  #publish(): void {
    this.state.replace(BACKGROUND_CONTEXT, {
      devices: this.#stored.devices.map(summary),
      recoveryCodesRemaining: this.#stored.recoveryHashes.length,
    });
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function normalize(value: string): string {
  return value.trim().replace(/[\s-]/g, "").toLowerCase();
}
function summary({ hash: _hash, ...device }: StoredDevice): DeviceSummary {
  return device;
}
function validStored(value: unknown): value is Stored {
  if (value === null || typeof value !== "object") return false;
  const { devices, recoveryHashes } = value as Partial<Stored>;
  return (
    Array.isArray(devices) &&
    devices.every(
      (device) =>
        device !== null &&
        typeof device === "object" &&
        typeof device.id === "string" &&
        typeof device.name === "string" &&
        typeof device.hash === "string" &&
        Number.isFinite(device.createdAt) &&
        Number.isFinite(device.lastSeenAt),
    ) &&
    Array.isArray(recoveryHashes) &&
    recoveryHashes.every((hash) => typeof hash === "string")
  );
}

export function deviceName(userAgent = ""): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : undefined;
  return os === undefined ? browser : `${browser} on ${os}`;
}
