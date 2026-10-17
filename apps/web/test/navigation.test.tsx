// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { navigate, parseRoute, routeHash, subscribeNavigation, useLocationHash } from "../src/app/navigation.ts";

afterEach(cleanup);
function Location() {
  return <output>{useLocationHash()}</output>;
}

test("pushState, browser Back/Forward, and native hash links share navigation notifications", async () => {
  window.history.replaceState(null, "", "/#41");
  render(<Location />);
  const listener = vi.fn();
  const stop = subscribeNavigation(listener);
  act(() => navigate("/#public-access"));
  expect(screen.getByRole("status").textContent).toBe("#public-access");
  expect(listener).toHaveBeenCalledOnce();
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("#41"));
  act(() => window.history.forward());
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("#public-access"));
  act(() => {
    window.location.hash = "42";
  });
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("#42"));
  stop();
  listener.mockClear();
  act(() => navigate("/#43"));
  expect(listener).not.toHaveBeenCalled();
});

test("routes have explicit page semantics, including unknown destinations", () => {
  for (const route of [
    { kind: "none" },
    { kind: "publicAccess" },
    { kind: "conversation", id: 42 },
    { kind: "unknown", hash: "#future-page" },
  ] as const)
    expect(parseRoute(routeHash(route))).toEqual(route);
  expect(parseRoute("#")).toEqual({ kind: "none" });
  expect(parseRoute("#-1")).toEqual({ kind: "unknown", hash: "#-1" });
  expect(parseRoute("#1.5")).toEqual({ kind: "unknown", hash: "#1.5" });
});

test("application navigation cannot push a foreign origin", () => {
  expect(() => navigate("https://example.invalid/#42")).toThrow("this origin");
});
