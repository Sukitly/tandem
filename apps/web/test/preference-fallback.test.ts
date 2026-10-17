// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearLegacyToken } from "../src/rpc/token.ts";

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

test("a blocked legacy storage migration still strips the token from the URL", () => {
  window.history.replaceState(null, "", "/?token=legacy&other=keep#42");
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  expect(() => clearLegacyToken()).not.toThrow();
  expect(window.location.search).toBe("?other=keep");
  expect(window.location.hash).toBe("#42");
});
