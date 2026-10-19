// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useConversationId, useNewConversationWorkspaceId, useOnPublicAccess } from "../src/app/current-route.ts";
import { createAppRouter } from "../src/app/router.tsx";

const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const values = {
    workspaces: { workspaces: [{ id: 1 }, { id: 3 }] },
    conversations: {
      conversations: [
        { id: 41, workspaceId: 1 },
        { id: 42, workspaceId: 3 },
      ],
    },
  };
  return {
    values,
    listeners,
    addProject: vi.fn(),
    /** What the server tells the page, and the page being told. */
    set(next: Partial<typeof values>) {
      Object.assign(values, next);
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("../src/rpc/connection.tsx", () => ({
  // A replicated state is named by its key, and read as the server's latest.
  useConnected: () => ({ workspaces: { state: "workspaces" }, conversations: { state: "conversations" } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({
  useReplicatedState: (key: "workspaces" | "conversations") =>
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      () => state.values[key],
    ),
}));
vi.mock("../src/app/workbench.tsx", () => ({ useWorkbench: () => ({ addProject: state.addProject }) }));
vi.mock("../src/app/sidebar-brand.tsx", () => ({ SidebarToggle: () => null }));
vi.mock("../src/app/empty-workspace.tsx", () => ({
  EmptyWorkspace: ({ empty }: { empty: boolean }) => <p>{empty ? "No project" : "Choose a conversation"}</p>,
}));
vi.mock("../src/chat/chat-view.tsx", () => ({
  ChatView: ({ conversationId }: { conversationId: number }) => <p>Conversation {conversationId}</p>,
  NewChat: ({ workspaceId }: { workspaceId: number }) => <p>New conversation in {workspaceId}</p>,
}));
vi.mock("../src/auth/pair-screen.tsx", () => ({
  PairScreen: ({ initialCode }: { initialCode?: string }) => <p>Pair with {initialCode ?? "nothing"}</p>,
}));

const mounted = vi.fn();
const unmounted = vi.fn();
/** Stands for the session: it draws the open page, and says what the address names. */
function Session() {
  const conversation = useConversationId();
  const project = useNewConversationWorkspaceId();
  const publicAccess = useOnPublicAccess();
  useEffect(() => {
    mounted();
    return unmounted;
  }, []);
  return (
    <>
      <input aria-label="Draft" />
      <output aria-label="Address">{JSON.stringify({ conversation, project, publicAccess })}</output>
      <Outlet />
    </>
  );
}

async function open(path: string, pairCode?: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    pairCode,
    layout: Session,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}
const address = () => JSON.parse(screen.getByLabelText("Address").textContent ?? "null");

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  state.set({
    workspaces: { workspaces: [{ id: 1 }, { id: 3 }] },
    conversations: {
      conversations: [
        { id: 41, workspaceId: 1 },
        { id: 42, workspaceId: 3 },
      ],
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mounted.mockClear();
  unmounted.mockClear();
});

test("the address says which page is open and what it is about", async () => {
  await open("/");
  expect(screen.getByText("Choose a conversation")).toBeTruthy();
  expect(address()).toEqual({ conversation: null, project: null, publicAccess: false });
  cleanup();

  await open("/c/41");
  expect(screen.getByText("Conversation 41")).toBeTruthy();
  expect(address()).toEqual({ conversation: 41, project: null, publicAccess: false });
  cleanup();

  await open("/p/3/new");
  expect(screen.getByText("New conversation in 3")).toBeTruthy();
  expect(address()).toEqual({ conversation: null, project: 3, publicAccess: false });
  cleanup();

  await open("/public-access");
  expect(address()).toEqual({ conversation: null, project: null, publicAccess: true });
});

test("the session and a draft in it survive moving between pages and through browser history", async () => {
  const router = await open("/c/41");
  const draft = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Unsent" } });

  await act(() => router.navigate({ to: "/public-access" }));
  expect(address().publicAccess).toBe(true);
  await act(() => router.navigate({ to: "/c/$conversationId", params: { conversationId: "42" } }));
  expect(screen.getByText("Conversation 42")).toBeTruthy();
  act(() => router.history.back());
  await waitFor(() => expect(address().publicAccess).toBe(true));
  act(() => router.history.back());
  await waitFor(() => expect(screen.getByText("Conversation 41")).toBeTruthy());

  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Unsent");
  expect(mounted).toHaveBeenCalledOnce();
  expect(unmounted).not.toHaveBeenCalled();
});

test("a conversation that is not among the conversations is not a page, and Back does not return to it", async () => {
  const router = await open("/c/7");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(screen.getByText("Choose a conversation")).toBeTruthy();
  expect(router.history.canGoBack()).toBe(false);
});

test("a conversation that goes away while it is open leaves by itself", async () => {
  const router = await open("/c/41");
  expect(screen.getByText("Conversation 41")).toBeTruthy();
  act(() => state.set({ conversations: { conversations: [{ id: 42, workspaceId: 3 }] } }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("a project that is not among the projects is not a place to start a conversation", async () => {
  const router = await open("/p/9/new");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(screen.queryByText(/New conversation in/)).toBeNull();
});

test.each(["/c/abc", "/c/-1", "/c/1.5", "/p/x/new", "/nowhere", "/c/41/extra"])(
  "%s is a page that is not found, inside the session",
  async (path) => {
    await open(path);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Draft" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to workspace" }).getAttribute("href")).toBe("/");
  },
);

test("pairing is outside the session, and is given the code the page was opened with", async () => {
  await open("/pair", "abc123");
  expect(screen.getByText("Pair with abc123")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
  expect(mounted).not.toHaveBeenCalled();
});

test("with no projects at all, the home page offers to add one", async () => {
  state.set({ workspaces: { workspaces: [] } });
  await open("/");
  expect(screen.getByText("No project")).toBeTruthy();
});
