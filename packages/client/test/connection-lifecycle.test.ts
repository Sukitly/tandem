import { afterEach, expect, test, vi } from "vitest";
import { onConnectionWake } from "../src/connection-lifecycle.ts";

afterEach(() => vi.unstubAllGlobals());

test("wake listeners ignore hidden/offline hints and are removed from their original targets", () => {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const browser = new EventTarget();
  const network = { onLine: true };
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("navigator", network);
  const wake = vi.fn();
  const stop = onConnectionWake(wake);
  browser.dispatchEvent(new Event("online"));
  expect(wake).toHaveBeenCalledOnce();
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  browser.dispatchEvent(new Event("focus"));
  page.visibilityState = "visible";
  network.onLine = false;
  browser.dispatchEvent(new Event("online"));
  expect(wake).toHaveBeenCalledOnce();
  network.onLine = true;
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("window", new EventTarget());
  stop();
  page.dispatchEvent(new Event("visibilitychange"));
  for (const event of ["online", "pageshow", "focus"]) browser.dispatchEvent(new Event(event));
  expect(wake).toHaveBeenCalledOnce();
});

test("lifecycle observation is a no-op without a DOM", () => {
  vi.stubGlobal("document", undefined);
  vi.stubGlobal("window", undefined);
  const stop = onConnectionWake(() => {});
  expect(stop).not.toThrow();
});
