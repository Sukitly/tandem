// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAppRouter } from "../src/app/router.tsx";
import { ErrorBoundary } from "../src/components/error-boundary.tsx";

/** Draws, or fails to, as the test says; a failure is what a page's own code does when it meets data it cannot draw. */
const fault = { on: true };
function Fragile({ name = "part" }: { name?: string }) {
  if (fault.on) throw new Error(`The ${name} cannot be drawn`);
  return <p>The {name} is drawn</p>;
}

beforeEach(() => {
  fault.on = true;
  // React and the boundary both report what they catch; a test that expects it needs no noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a part that fails is replaced by what failed and why, and what is beside it carries on", () => {
  render(
    <>
      <p>Beside it</p>
      <ErrorBoundary what="the Changes tab">
        <Fragile />
      </ErrorBoundary>
    </>,
  );
  expect(screen.getByText("Beside it")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Could not show the Changes tab");
  expect(screen.getByRole("alert").textContent).toContain("The part cannot be drawn");
  expect(console.error).toHaveBeenCalledWith("Could not show the Changes tab", expect.any(Error));
});

test("trying again draws the part anew, and a part that still fails is still said to have", () => {
  render(
    <ErrorBoundary what="the part">
      <Fragile />
    </ErrorBoundary>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  fault.on = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("The part is drawn")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a part that is about something else than it was is drawn anew without being asked", () => {
  function About() {
    const [id, setId] = useState(1);
    return (
      <>
        <button type="button" onClick={() => setId(2)}>
          Next
        </button>
        <ErrorBoundary what="the part" resetKey={id}>
          {id === 1 ? <Fragile /> : <p>Part {id}</p>}
        </ErrorBoundary>
      </>
    );
  }
  render(<About />);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Part 2")).toBeTruthy();
});

test("a part that fills its place offers a reload, and one among others only offers to try again", () => {
  const { unmount } = render(
    <ErrorBoundary what="the part">
      <Fragile />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  unmount();
  render(
    <ErrorBoundary what="this message" compact>
      <Fragile />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
});

test("one of several parts that fails leaves the others drawn", () => {
  render(
    <div>
      {["first", "second", "third"].map((name) => (
        <ErrorBoundary key={name} what={`the ${name} part`} compact>
          {name === "second" ? <Fragile name={name} /> : <p>The {name} is drawn</p>}
        </ErrorBoundary>
      ))}
    </div>,
  );
  expect(screen.getByText("The first is drawn")).toBeTruthy();
  expect(screen.getByText("The third is drawn")).toBeTruthy();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

vi.mock("../src/chat/chat-view.tsx", () => ({
  ChatView: ({ conversationId }: { conversationId: number }) => {
    if (conversationId === 41) throw new Error("The conversation cannot be drawn");
    return <p>Conversation {conversationId}</p>;
  },
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ workspaces: { state: "workspaces" }, conversations: { state: "conversations" } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: (key: string) =>
    key === "conversations" ? { conversations: [{ id: 41 }, { id: 42 }] } : { workspaces: [{ id: 1 }] },
}));

test("a page that fails leaves the session around it, and going to another page draws it", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/c/41"] }),
    layout: () => (
      <>
        <nav>Sidebar</nav>
        <Outlet />
      </>
    ),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(screen.getByText("Sidebar")).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toContain("Could not show this page");
  await router.navigate({ to: "/c/$conversationId", params: { conversationId: "42" } });
  expect(await screen.findByText("Conversation 42")).toBeTruthy();
  expect(screen.getByText("Sidebar")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
