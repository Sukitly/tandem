// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCommand } from "../src/hooks/use-command.ts";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  toast.error.mockReset();
});

/** An action the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("a command is pending while it runs, and reports that it succeeded", async () => {
  const { result } = renderHook(() => useCommand());
  const action = deferred();
  let outcome!: Promise<boolean>;
  act(() => {
    outcome = result.current.run(() => action.promise);
  });
  expect(result.current.pending).toBe(true);
  await act(async () => action.resolve());
  expect(await outcome).toBe(true);
  expect(result.current.pending).toBe(false);
  expect(result.current.error).toBeNull();
});

test("a failure is kept as the command's error, and the next run clears it", async () => {
  const { result } = renderHook(() => useCommand());
  let outcome = true;
  await act(async () => {
    outcome = await result.current.run(() => Promise.reject(new Error("Denied")));
  });
  expect(outcome).toBe(false);
  expect(result.current.error).toBe("Denied");
  expect(result.current.pending).toBe(false);
  expect(toast.error).not.toHaveBeenCalled();

  const retry = deferred();
  act(() => {
    void result.current.run(() => retry.promise);
  });
  expect(result.current.error).toBeNull();
  await act(async () => retry.resolve());
});

test("a failure that is not an Error is shown as text, and an action that throws is a failure", async () => {
  const { result } = renderHook(() => useCommand());
  await act(async () => {
    await result.current.run(() => Promise.reject("plain"));
  });
  expect(result.current.error).toBe("plain");
  await act(async () => {
    await result.current.run(() => {
      throw new Error("Thrown");
    });
  });
  expect(result.current.error).toBe("Thrown");
});

test("a failure can be reported as a toast instead, leaving no error beside the action", async () => {
  const { result } = renderHook(() => useCommand({ failure: "Could not save" }));
  await act(async () => {
    expect(await result.current.run(() => Promise.reject(new Error("Denied")))).toBe(false);
  });
  expect(toast.error).toHaveBeenCalledWith("Could not save", { description: "Denied" });
  expect(result.current.error).toBeNull();
  expect(result.current.pending).toBe(false);
});

test("a second run while one is going is refused without running its action", async () => {
  const { result } = renderHook(() => useCommand());
  const first = deferred();
  const again = vi.fn().mockResolvedValue(undefined);
  let second = true;
  act(() => {
    void result.current.run(() => first.promise);
    // The same tick, before a disabled button could have rendered.
    void result.current.run(again).then((outcome) => {
      second = outcome;
    });
  });
  await waitFor(() => expect(second).toBe(false));
  expect(again).not.toHaveBeenCalled();
  await act(async () => first.resolve());
  await act(async () => {
    expect(await result.current.run(again)).toBe(true);
  });
  expect(again).toHaveBeenCalledOnce();
});

test("reset forgets the last failure", async () => {
  const { result } = renderHook(() => useCommand());
  await act(async () => {
    await result.current.run(() => Promise.reject(new Error("Denied")));
  });
  expect(result.current.error).toBe("Denied");
  act(() => result.current.reset());
  expect(result.current.error).toBeNull();
});

test("a failure after the component is gone is still reported as a toast, and changes no state", async () => {
  const { result, unmount } = renderHook(() => useCommand({ failure: "Could not save" }));
  const action = deferred();
  let outcome!: Promise<boolean>;
  act(() => {
    outcome = result.current.run(() => action.promise);
  });
  unmount();
  action.reject(new Error("Late"));
  expect(await outcome).toBe(false);
  expect(toast.error).toHaveBeenCalledWith("Could not save", { description: "Late" });
});
