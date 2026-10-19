// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("keeps preferences usable when storage is unavailable", async () => {
  const { preferences } = await import("../src/lib/preferences.ts");
  vi.stubGlobal("localStorage", undefined);
  expect(preferences.getItem("theme")).toBeNull();
  preferences.setItem("theme", "dark");
  expect(preferences.getItem("theme")).toBe("dark");
  preferences.removeItem("theme");
  expect(preferences.getItem("theme")).toBeNull();
});

test("a quota failure does not revert the in-memory choice to a stale stored value", async () => {
  const { preferences } = await import("../src/lib/preferences.ts");
  localStorage.setItem("theme", "light");
  const denied = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  preferences.setItem("theme", "dark");
  expect(preferences.getItem("theme")).toBe("dark");
  denied.mockRestore();
  preferences.setItem("theme", "system");
  expect(localStorage.getItem("theme")).toBe("system");
  expect(preferences.getItem("theme")).toBe("system");
});
