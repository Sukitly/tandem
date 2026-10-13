// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PairScreen, takePairingCode } from "../src/auth/pair-screen.tsx";
import { clearLegacyToken } from "../src/rpc/token.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("pairing a browser", () => {
  test("explains how to obtain the first pairing link", () => {
    render(createElement(PairScreen));
    expect(screen.getByText("bun run service pair")).toBeDefined();
  });
  test("takes the fragment out of history before any request, without consuming a code twice", () => {
    window.history.replaceState(null, "", "/pair#secret-code");
    expect(takePairingCode()).toBe("secret-code");
    expect(window.location.hash).toBe("");
    expect(takePairingCode()).toBeUndefined();
  });
  test("automatically pairs from a link once, including under StrictMode", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const onPaired = vi.fn();
    render(createElement(StrictMode, null, createElement(PairScreen, { initialCode: "code", onPaired })));
    await waitFor(() => expect(onPaired).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]).toEqual([
      "/auth/pair",
      { method: "POST", headers: { "content-type": "application/json" }, body: '{"code":"code"}' },
    ]);
  });
  test("an already paired browser does not create a duplicate device", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const onPaired = vi.fn();
    render(createElement(PairScreen, { initialCode: "unused", onPaired }));
    await waitFor(() => expect(onPaired).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test("invalid or expired links show the reason and allow a recovery code", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"error":"The code has expired"}', { status: 400 }))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const onPaired = vi.fn();
    render(createElement(PairScreen, { initialCode: "expired", onPaired }));
    await waitFor(() => expect(screen.getByText("The code has expired")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Pairing or recovery code"), { target: { value: "recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair device" }));
    await waitFor(() => expect(onPaired).toHaveBeenCalled());
    expect(fetch.mock.calls[2]?.[1]?.body).toBe('{"code":"recovery"}');
  });
  test("rate limit failures keep the typed recovery code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"Try again in one minute"}', { status: 429 })),
    );
    render(createElement(PairScreen));
    const input = screen.getByLabelText("Pairing or recovery code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "saved-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair device" }));
    await waitFor(() => expect(screen.getByText("Try again in one minute")).toBeDefined());
    expect(input.value).toBe("saved-code");
  });
  test("migration discards the old permanent token", () => {
    localStorage.setItem("tandem.token", "old-secret");
    window.history.replaceState(null, "", "/?token=old-secret&keep=yes");
    clearLegacyToken();
    expect(localStorage.getItem("tandem.token")).toBeNull();
    expect(window.location.search).toBe("?keep=yes");
  });
});
