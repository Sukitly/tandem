// @vitest-environment jsdom
import { Link } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SessionFrame } from "../src/app/session.tsx";
import { renderInRouter } from "./in-router.tsx";

vi.mock("../src/app/workbench-frame.tsx", () => ({
  WorkbenchFrame: () => (
    <>
      <input aria-label="Draft" />
      <Link to="/public-access">Open public access</Link>
    </>
  ),
}));
vi.mock("../src/tunnel/public-access.tsx", () => ({ PublicAccessPage: () => <main aria-label="Public access" /> }));
vi.mock("../src/rpc/connection.tsx", () => ({ ConnectionProvider: ({ children }: { children: unknown }) => children }));
vi.mock("../src/auth/devices-dialog.tsx", () => ({
  DevicesDialogProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("../src/models/providers-dialog.tsx", () => ({
  ProvidersDialogProvider: ({ children }: { children: unknown }) => children,
}));

afterEach(cleanup);

test("the public access page takes the screen while the workbench waits hidden, as it was", async () => {
  const { router } = await renderInRouter(<SessionFrame />, { path: "/c/42" });
  const draft = screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement;
  fireEvent.change(draft, { target: { value: "Unsent" } });
  expect(screen.queryByRole("main", { name: "Public access" })).toBeNull();
  expect(draft.closest("[hidden]")).toBeNull();

  fireEvent.click(screen.getByRole("link", { name: "Open public access" }));
  await waitFor(() => expect(screen.getByRole("main", { name: "Public access" })).toBeTruthy());
  expect(draft.closest("[hidden]")).not.toBeNull();
  expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();

  await router.navigate({ to: "/c/$conversationId", params: { conversationId: "42" } });
  await waitFor(() => expect(screen.queryByRole("main", { name: "Public access" })).toBeNull());
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft.value).toBe("Unsent");
  expect(draft.closest("[hidden]")).toBeNull();
});

test("opened directly at its address, the page is shown from the start", async () => {
  await renderInRouter(<SessionFrame />, { path: "/public-access" });
  expect(screen.getByRole("main", { name: "Public access" })).toBeTruthy();
});
