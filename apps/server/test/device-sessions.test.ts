import { mkdtemp, readFile, stat } from "node:fs/promises";
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
  test("five failed attempts block even a correct code for a minute", async () => {
    let now = 100;
    const store = await DeviceSessions.load(undefined, () => now);
    const pair = store.issue();
    for (let i = 0; i < 5; i++) await expect(store.redeem("wrong", "A")).rejects.toThrow();
    await expect(store.redeem(pair.code, "A")).rejects.toMatchObject({ status: 429 });
    now += 60_000;
    expect((await store.redeem(pair.code, "A")).secret).toBeDefined();
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
  test("a malformed credential file fails closed", async () => {
    const file = await tempFile();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, '{"devices": [{}], "recoveryHashes": []}');
    await expect(DeviceSessions.load(file)).rejects.toThrow(/Invalid/);
  });
});

test("device names reflect the browser and operating system", () => {
  expect(deviceName("Mozilla iPhone Safari/1")).toBe("Safari on iOS");
  expect(deviceName("Mozilla Android Chrome/1")).toBe("Chrome on Android");
  expect(deviceName()).toBe("Browser");
});
