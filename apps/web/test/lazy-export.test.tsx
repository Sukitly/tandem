// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ErrorBoundary } from "../src/components/error-boundary.tsx";
import { lazyExport } from "../src/lib/lazy-export.ts";

afterEach(cleanup);

test("a component is loaded when it is first drawn, not when it is declared, and a spinner waits for it", async () => {
  const load = vi.fn(async () => ({ Thing: ({ name }: { name: string }) => <p>Thing {name}</p> }));
  const Thing = lazyExport(load, "Thing");
  expect(load).not.toHaveBeenCalled();

  render(
    <Suspense fallback={<p>Loading</p>}>
      <Thing name="one" />
    </Suspense>,
  );
  expect(screen.getByText("Loading")).toBeTruthy();
  expect(await screen.findByText("Thing one")).toBeTruthy();
  expect(load).toHaveBeenCalledOnce();
});

test("a script that fails to load is shown by the nearest error boundary, with a reload to mend it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Thing = lazyExport(() => Promise.reject(new Error("Failed to fetch the script")), "Thing");
  render(
    <ErrorBoundary what="the view">
      <Suspense fallback={<p>Loading</p>}>
        <Thing />
      </Suspense>
    </ErrorBoundary>,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("Failed to fetch the script");
  expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  vi.restoreAllMocks();
});
