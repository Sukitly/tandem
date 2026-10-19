// @vitest-environment jsdom
import type { PublicAccess, PublicAccessStatus } from "@tandem/contracts";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { isSettled, usePublishing } from "../src/tunnel/use-publishing.ts";

function service(overrides: Partial<Pick<PublicAccess, "publish" | "unpublish">> = {}) {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    unpublish: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PublicAccess;
}
const input = { publicUrl: "https://tandem.example.com", token: "t" };

test("a tunnel is settled once it is connected, failed, unavailable, or none, and not while it starts or authorizes", () => {
  for (const status of ["connected", "failed", "unavailable", "none"] as const)
    expect(isSettled(status), status).toBe(true);
  for (const status of ["starting", "authorizing"] as const) expect(isSettled(status), status).toBe(false);
});

test("publishing is under way while the request is, and while the tunnel starts or authorizes without one", async () => {
  let answer!: () => void;
  const publicAccess = service({ publish: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))) });
  const view = renderHook(({ status }) => usePublishing(publicAccess, status), {
    initialProps: { status: "none" as PublicAccessStatus },
  });
  expect(view.result.current.publishing).toBe(false);
  let done!: Promise<void>;
  act(() => {
    done = view.result.current.publish(input);
  });
  expect(view.result.current.publishing).toBe(true);
  await act(async () => {
    answer();
    await done;
  });
  expect(view.result.current.publishing).toBe(false);
  view.rerender({ status: "authorizing" });
  expect(view.result.current.publishing).toBe(true);
  view.rerender({ status: "starting" });
  expect(view.result.current.publishing).toBe(true);
  view.rerender({ status: "connected" });
  expect(view.result.current.publishing).toBe(false);
});

test("the tunnel settling ends a start even before the server answers the request", async () => {
  const publicAccess = service({ publish: vi.fn(() => new Promise<void>(() => {})) });
  const view = renderHook(({ status }) => usePublishing(publicAccess, status), {
    initialProps: { status: "none" as PublicAccessStatus },
  });
  act(() => {
    void view.result.current.publish(input);
  });
  expect(view.result.current.publishing).toBe(true);
  view.rerender({ status: "starting" });
  view.rerender({ status: "connected" });
  expect(view.result.current.publishing).toBe(false);
});

test("a start the server refuses is kept as the error, and the next try clears it", async () => {
  const publicAccess = service({
    publish: vi.fn().mockRejectedValueOnce(new Error("The token is not valid")).mockResolvedValue(undefined),
  });
  const view = renderHook(() => usePublishing(publicAccess, "none"));
  await act(() => view.result.current.publish(input));
  expect(view.result.current.error).toBe("The token is not valid");
  expect(view.result.current.publishing).toBe(false);
  await act(() => view.result.current.publish(input));
  expect(view.result.current.error).toBeNull();
});

test("stopping says whether the tunnel was stopped, and what refused it", async () => {
  const publicAccess = service({
    unpublish: vi.fn().mockRejectedValueOnce(new Error("Busy")).mockResolvedValue(undefined),
  });
  const view = renderHook(() => usePublishing(publicAccess, "connected"));
  let stopped = true;
  await act(async () => {
    stopped = await view.result.current.stop();
  });
  expect(stopped).toBe(false);
  expect(view.result.current.error).toBe("Busy");
  expect(view.result.current.stopping).toBe(false);
  await act(async () => {
    stopped = await view.result.current.stop();
  });
  expect(stopped).toBe(true);
  expect(view.result.current.error).toBeNull();
});
