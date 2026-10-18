// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { navigate, useRoute } from "../src/app/navigation.ts";
import { ApplicationRouter } from "../src/app/router.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the actual router preserves the shell and draft DOM across pages and browser history", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState(null, "", "/#41");
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Shell() {
    const route = useRoute();
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <>
        <input aria-label="Draft" />
        <output>{JSON.stringify(route)}</output>
      </>
    );
  }
  render(
    <ApplicationRouter>
      <Shell />
    </ApplicationRouter>,
  );
  const draft = await screen.findByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Unsent" } });
  act(() => navigate("/#public-access"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("publicAccess"));
  expect(screen.getByRole("textbox")).toBe(draft);
  act(() => navigate("/#42"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain('"id":42'));
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("publicAccess"));
  expect((draft as HTMLInputElement).value).toBe("Unsent");
  expect(mounted).toHaveBeenCalledOnce();
  expect(unmounted).not.toHaveBeenCalled();
});
