import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DeviceSessions, deviceName, PAIR_LIFETIME_MS, SESSION_IDLE_MS } from "../src/device-sessions.ts";

const tempFile = async () => join(await mkdtemp(join(tmpdir(), "tandem-devices-")), "devices.json");

describe("device sessions", () => {
  test("pairs once, persists only hashes, and authenticates after a restart", async () => {
    const file = await tempFile();
    const store = await DeviceSessions.load(file);
    const pair = store.issue();
    const { secret, device } = await store.redeem(pair.code, "Phone");
    await expect(store.redeem(pair.code, "Other")).rejects.toThrow(/already used/);
    expect(await store.authenticate(secret)).toEqual(device);
    const stored = await readFile(file, "utf8");
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(pair.code);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await (await DeviceSessions.load(file)).authenticate(secret)).toEqual(device);
    expect(store.state.value.devices[0]).not.toHaveProperty("hash");
  });
  test("a pairing code expires in five minutes and cannot be redeemed concurrently twice", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const expired = store.issue();
    now += PAIR_LIFETIME_MS;
    await expect(store.redeem(expired.code, "A")).rejects.toThrow(/expired/);
    const pair = store.issue();
    const results = await Promise.allSettled([store.redeem(pair.code, "A"), store.redeem(pair.code, "B")]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
  test("idle sessions expire, activity extends the idle window, and revoke invalidates immediately", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const first = await store.redeem(store.issue().code, "A");
    now += SESSION_IDLE_MS - 1;
    expect(await store.authenticate(first.secret)).toBeDefined();
    now += SESSION_IDLE_MS;
    expect(await store.authenticate(first.secret)).toBeUndefined();
    const second = await store.redeem(store.issue().code, "B");
    await store.revoke(second.device.id);
    expect(await store.authenticate(second.secret)).toBeUndefined();
  });
  test("recovery codes are single use, survive a restart, and regeneration invalidates old codes", async () => {
    const file = await tempFile();
    const store = await DeviceSessions.load(file);
    const codes = await store.regenerateRecoveryCodes();
    expect(codes).toHaveLength(10);
    const saved = await readFile(file, "utf8");
    for (const code of codes) expect(saved).not.toContain(code);
    const restarted = await DeviceSessions.load(file);
    await restarted.redeem(codes[0] as string, "Recovered");
    expect(restarted.state.value.recoveryCodesRemaining).toBe(9);
    await expect(restarted.redeem(codes[0] as string, "Replay")).rejects.toThrow();
    await restarted.regenerateRecoveryCodes();
    await expect(restarted.redeem(codes[1] as string, "Old")).rejects.toThrow();
  });
  test("invalid attempts back off without blocking valid pairing or recovery codes", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const pair = store.issue();
    for (let i = 0; i < 5; i++) await expect(store.redeem("wrong", "A")).rejects.toThrow();
    await expect(store.redeem("wrong", "A")).rejects.toMatchObject({ status: 429 });
    const recovery = await store.regenerateRecoveryCodes();
    expect((await store.redeem(pair.code, "A")).secret).toBeDefined();
    expect((await store.redeem(recovery[0] as string, "B")).secret).toBeDefined();
    await expect(store.redeem(pair.code, "Replay")).rejects.toMatchObject({ status: 429 });
    await expect(store.redeem(recovery[0] as string, "Replay")).rejects.toMatchObject({ status: 429 });
    now += 60_000;
    await expect(store.redeem("wrong", "A")).rejects.toMatchObject({ status: 400 });
  });
  test("revoking others preserves the selected device and publishes metadata without secrets", async () => {
    const store = await DeviceSessions.load();
    const a = await store.redeem(store.issue().code, "A");
    const b = await store.redeem(store.issue().code, "B");
    await store.rename(a.device.id, "Laptop");
    await store.revokeOthers(a.device.id);
    expect(store.state.value.devices.map((device) => device.name)).toEqual(["Laptop"]);
    expect(await store.authenticate(b.secret)).toBeUndefined();
  });
  test("open sockets maintain activity and release records their final activity", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const { secret, device } = await store.redeem(store.issue().code, "A");
    const release = store.hold(device.id);
    now += SESSION_IDLE_MS + 100;
    await store.touchActive();
    expect(await store.authenticate(secret)).toBeDefined();
    now += 100;
    await release();
    now += SESSION_IDLE_MS - 1;
    expect(await store.authenticate(secret)).toBeDefined();
  });
  test("recovery codes are groups of four, and are accepted however a person types them", async () => {
    const store = await DeviceSessions.load();
    const [code] = await store.regenerateRecoveryCodes();
    expect(code).toMatch(/^([0-9a-f]{4}-){7}[0-9a-f]{4}$/);
    const typed = `  ${(code as string).toUpperCase().replaceAll("-", " ")}  `;
    expect((await store.redeem(typed, "Typed")).secret).toBeDefined();
  });
  test("renaming changes only the device it names", async () => {
    const store = await DeviceSessions.load();
    const a = await store.redeem(store.issue().code, "A");
    await store.redeem(store.issue().code, "B");
    await store.rename(a.device.id, "Laptop");
    expect(store.state.value.devices.map((device) => device.name)).toEqual(["Laptop", "B"]);
  });
  describe("a credential file that is not well formed fails closed", () => {
    const device = { id: "i", name: "n", hash: "h", createdAt: 1, lastSeenAt: 1 };
    const file = (devices: unknown, recoveryHashes: unknown = []) => JSON.stringify({ devices, recoveryHashes });
    test.each([
      ["null", "null"],
      ["a list", "[]"],
      ["devices that are not a list", file({})],
      ["no recovery hashes", JSON.stringify({ devices: [] })],
      ["recovery hashes that are not a list", file([], {})],
      ["a recovery hash that is not text", file([], [1])],
      ["a device that is null", file([null])],
      ["a device without an id", file([{ ...device, id: 1 }])],
      ["a device without a name", file([{ ...device, name: 1 }])],
      ["a device without a hash", file([{ ...device, hash: 1 }])],
      ["a device without a creation time", file([{ ...device, createdAt: "1" }])],
      ["a device without a last-seen time", file([{ ...device, lastSeenAt: "1" }])],
    ])("%s", async (_name, text) => {
      const path = await tempFile();
      await writeFile(path, text);
      await expect(DeviceSessions.load(path)).rejects.toThrow(/Invalid/);
    });

    test("while a well formed one loads", async () => {
      const path = await tempFile();
      await writeFile(path, file([device], ["r"]));
      const store = await DeviceSessions.load(path);
      expect(store.state.value).toEqual({
        devices: [{ id: "i", name: "n", createdAt: 1, lastSeenAt: 1 }],
        recoveryCodesRemaining: 1,
      });
    });
  });
  test("revoking tells the listeners of each device that went, and revoking others spares the one kept", async () => {
    const store = await DeviceSessions.load();
    const revoked: string[] = [];
    const stop = store.onRevoke((id) => revoked.push(id));
    const [a, b, c, d] = [
      await store.redeem(store.issue().code, "A"),
      await store.redeem(store.issue().code, "B"),
      await store.redeem(store.issue().code, "C"),
      await store.redeem(store.issue().code, "D"),
    ];
    await store.revoke(b.device.id);
    expect(revoked).toEqual([b.device.id]);
    await expect(store.revokeOthers("missing")).rejects.toThrow(/does not exist/);
    expect(store.state.value.devices).toHaveLength(3);
    await store.revokeOthers(a.device.id);
    expect(revoked).toEqual([b.device.id, c.device.id, d.device.id]);
    expect(store.state.value.devices.map((device) => device.id)).toEqual([a.device.id]);
    stop();
    await store.revoke(a.device.id);
    expect(revoked).toHaveLength(3);
  });
  test("a device that expired from idleness is announced as revoked", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const revoked: string[] = [];
    store.onRevoke((id) => revoked.push(id));
    const { secret, device } = await store.redeem(store.issue().code, "A");
    now += SESSION_IDLE_MS;
    expect(await store.authenticate(secret)).toBeUndefined();
    expect(revoked).toEqual([device.id]);
    expect(store.state.value.devices).toEqual([]);
  });
  test("a device stays active until every open socket is released, and releasing twice counts once", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const { secret, device } = await store.redeem(store.issue().code, "A");
    const first = store.hold(device.id);
    const second = store.hold(device.id);
    await first();
    await first();
    now += SESSION_IDLE_MS + 1;
    expect(await store.authenticate(secret)).toBeDefined();
    await second();
    now += SESSION_IDLE_MS;
    expect(await store.authenticate(secret)).toBeUndefined();
  });
  test("last seen is refreshed at most once an hour, and for open sockets only by touchActive", async () => {
    const hour = 60 * 60 * 1000;
    let now = 1_000;
    const store = await DeviceSessions.load(undefined, () => now);
    const a = await store.redeem(store.issue().code, "A");
    const b = await store.redeem(store.issue().code, "B");
    const lastSeen = (id: string) => store.state.value.devices.find((device) => device.id === id)?.lastSeenAt;

    now = 1_000 + hour - 1;
    await store.authenticate(a.secret);
    expect(lastSeen(a.device.id)).toBe(1_000);
    now += 1;
    await store.authenticate(a.secret);
    expect(lastSeen(a.device.id)).toBe(now);

    const release = store.hold(b.device.id);
    now = 1_000 + hour - 1;
    await store.touchActive();
    expect(lastSeen(b.device.id)).toBe(1_000);
    now += 1;
    await store.touchActive();
    expect(lastSeen(b.device.id)).toBe(now);
    // The first device has no open socket, so touchActive left it as it was.
    expect(lastSeen(a.device.id)).toBe(1_000 + hour);
    await release();
  });
  test("at most a hundred pairing links are pending, until some expire", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    for (let index = 0; index < 100; index += 1) store.issue();
    expect(() => store.issue()).toThrow(/Too many pending/);
    expect(() => store.issue()).toThrowError(expect.objectContaining({ status: 429 }));
    now += PAIR_LIFETIME_MS;
    expect(() => store.issue()).not.toThrow();
  });
  test.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0",
      "Edge on Windows",
    ],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox on macOS"],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Chrome on Linux",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Safari on macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Browser on Linux"],
    ["curl/8.0", "Browser"],
    ["", "Browser"],
  ])("names a device after its browser and system: %s", (userAgent, name) => {
    expect(deviceName(userAgent)).toBe(name);
  });
});
