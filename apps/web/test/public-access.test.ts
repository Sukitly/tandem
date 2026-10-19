// @vitest-environment jsdom
import { Link } from "@tanstack/react-router";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useOnPublicAccess } from "../src/app/current-route.ts";
import { PublicAccessPage } from "../src/tunnel/public-access.tsx";
import { renderInRouter } from "./in-router.tsx";

const mock = vi.hoisted(() => ({
  state: { status: "none", cloudflared: true } as Record<string, unknown>,
  publish: vi.fn(),
  unpublish: vi.fn(),
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ publicAccess: { state: mock.state, publish: mock.publish, unpublish: mock.unpublish } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));

/** Stands for the session: the page when its address is open, and a link to it otherwise. */
function Frame() {
  return useOnPublicAccess() ? createElement(PublicAccessPage) : createElement(Link, { to: "/public-access" }, "Open");
}

async function setup(path = "/public-access") {
  return renderInRouter(createElement(Frame), { path });
}

function fill(address: string, token: string) {
  fireEvent.change(screen.getByLabelText("The address it will answer at"), { target: { value: address } });
  fireEvent.change(screen.getByLabelText("Tunnel token"), { target: { value: token } });
}

beforeEach(() => {
  mock.state = { status: "none", cloudflared: true };
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("opens a dedicated page from a real link, and Back returns to the page it left", async () => {
  const { router } = await setup("/c/42");
  expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/public-access");
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Public access" })).toBeDefined());
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Back to workspace" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "Open" })).toBeDefined());
  expect(router.state.location.pathname).toBe("/c/42");
});

test("opened directly, the page's Back goes to the workspace, as there is no page before it", async () => {
  const { router } = await setup("/public-access");
  expect(screen.getByRole("main", { name: "Public access" })).toBeDefined();
  const back = screen.getByRole("link", { name: "Back to workspace" });
  expect(back.getAttribute("href")).toBe("/");
  fireEvent.click(back);
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(screen.queryByRole("main", { name: "Public access" })).toBeNull();
});

test.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])(
  "leaves a modified click on Back to the browser: %j",
  async (modifiers) => {
    const { router } = await setup("/public-access");
    // The click is stopped at the document, as the browser's own navigation is not run here.
    const reached = vi.fn();
    const stop = (event: Event): void => {
      reached(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", stop);
    try {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
      fireEvent(screen.getByRole("link", { name: "Back to workspace" }), event);
    } finally {
      document.removeEventListener("click", stop);
    }
    expect(reached).toHaveBeenCalledWith(false);
    expect(router.state.location.pathname).toBe("/public-access");
    expect(screen.getByRole("main", { name: "Public access" })).toBeDefined();
  },
);

test("walks the website path in order, saying where each step happens and what it looks like when done", async () => {
  await setup();
  const steps = within(screen.getByRole("list", { name: "Cloudflare website setup steps" })).getAllByRole("heading", {
    level: 3,
  });
  expect(steps.map((step) => step.textContent)).toEqual([
    "Create a tunnel",
    "Connect this machine",
    "Protect the hostname",
    "Publish the route",
    "Verify, then pair your phone",
  ]);
  for (const where of ["Cloudflare", "Tandem", "Phone"]) {
    expect(screen.getAllByText(where).length).toBeGreaterThan(0);
  }
  expect(screen.getAllByText(/Done when:/).length).toBeGreaterThan(0);
});

test("says the token comes from the manual command, without running it", async () => {
  await setup();
  expect(screen.getByText(/The value after --token, not the whole command/)).toBeDefined();
});

test("publishes the address and the token the person entered", async () => {
  mock.publish.mockResolvedValue(undefined);
  await setup();
  fill("https://tandem.example.com", "eyJhIjoi");
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(mock.publish).toHaveBeenCalledWith(
    { publicUrl: "https://tandem.example.com", token: "eyJhIjoi" },
    expect.anything(),
  );
});

test("automatically extracts token if user pastes the full cloudflared run command", async () => {
  mock.publish.mockResolvedValue(undefined);
  await setup();
  fill("https://tandem.example.com", "cloudflared tunnel run --token eyJhbGciOiJIUzI1NiJ9");
  expect((screen.getByLabelText("Tunnel token") as HTMLInputElement).value).toBe("eyJhbGciOiJIUzI1NiJ9");
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(mock.publish).toHaveBeenCalledWith(
    { publicUrl: "https://tandem.example.com", token: "eyJhbGciOiJIUzI1NiJ9" },
    expect.anything(),
  );
});

test("refuses to publish without HTTPS or without a token", async () => {
  await setup();
  fill("http://tandem.example.com", "eyJhIjoi");
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  fill("https://tandem.example.com", "");
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  expect(mock.publish).not.toHaveBeenCalled();
});

test("names Cloudflare Access as a step, with the hostname it protects", async () => {
  await setup();
  expect(screen.getByText("A connected tunnel is not a login")).toBeDefined();
  expect(screen.getByText(/Never/).textContent).toContain("Bypass");
  expect(screen.getByRole("link", { name: "Open Cloudflare Access applications" }).getAttribute("href")).toBe(
    "https://one.dash.cloudflare.com/?to=/:account/access-controls/apps",
  );
  expect(screen.getByText("Self-hosted")).toBeDefined();
  expect(screen.getByText("A different, unlisted email is refused.")).toBeDefined();
});

test("directly jumps to the specific tunnel routes and access pages when tunnel identity is known", async () => {
  mock.state = {
    status: "connected",
    cloudflared: true,
    publicUrl: "https://tandem.example.com",
    tunnel: { accountId: "1234567890abcdef1234567890abcdef", tunnelId: "c4648dd8-acd3-48f5-9004-3f3dc20192c2" },
  };
  await setup();
  const routeLinks = screen.getAllByRole("link", { name: "Open Tunnel in Cloudflare" });
  expect(routeLinks.length).toBeGreaterThanOrEqual(1);
  for (const link of routeLinks) {
    expect(link.getAttribute("href")).toBe(
      "https://one.dash.cloudflare.com/1234567890abcdef1234567890abcdef/networks/connectors/cloudflare-tunnels/cfd_tunnel/c4648dd8-acd3-48f5-9004-3f3dc20192c2/edit?tab=publicHostname",
    );
  }
  const accessLink = screen.getByRole("link", { name: "Open Cloudflare Access applications" });
  expect(accessLink.getAttribute("href")).toBe(
    "https://one.dash.cloudflare.com/1234567890abcdef1234567890abcdef/access-controls/apps",
  );
});

test("walks the CLI path on this machine, and on another computer with only a token", async () => {
  await setup();
  fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
  expect(screen.getByText("bun run tunnel setup --public-url https://tandem.example.com")).toBeDefined();
  expect(screen.queryByText("bun run tunnel create --public-url https://tandem.example.com")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Another computer" }));
  expect(screen.getByText("bun run tunnel create --public-url https://tandem.example.com")).toBeDefined();
  expect(
    screen.getByText("bun run tunnel configure --public-url https://tandem.example.com --token-file -"),
  ).toBeDefined();
  expect(screen.getByText(/Only a token travels between them/)).toBeDefined();
  expect(screen.queryByText("bun run tunnel setup --public-url https://tandem.example.com")).toBeNull();
  expect(mock.publish).not.toHaveBeenCalled();
});

test("keeps the entered token when the setup method changes", async () => {
  await setup();
  fill("https://tandem.example.com", "saved-token");
  fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
  fireEvent.click(screen.getByRole("tab", { name: "Cloudflare website" }));
  expect((screen.getByLabelText("Tunnel token") as HTMLInputElement).value).toBe("saved-token");
});

test("shows how to install cloudflared and blocks publishing without it", async () => {
  mock.state = { status: "none", cloudflared: false };
  await setup();
  expect(screen.getByRole("heading", { name: "Install cloudflared on the host" })).toBeDefined();
  expect(screen.getByText("brew install cloudflared")).toBeDefined();
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
});

test("reports a connected tunnel, replaces the publish form, and offers to stop", async () => {
  mock.state = { status: "connected", cloudflared: true, publicUrl: "https://tandem.example.com" };
  mock.unpublish.mockResolvedValue(undefined);
  await setup();
  expect(screen.getByText(/Tunnel connected for/)).toBeDefined();
  expect(screen.getByText(/The address only reaches it once you finish the route and Access steps/)).toBeDefined();
  expect(screen.queryByLabelText("Tunnel token")).toBeNull();
  expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  const steps = screen.getByRole("list", { name: "Cloudflare website setup steps" });
  expect(within(steps).getByText(/This machine is already connected/)).toBeDefined();
  expect(screen.getAllByRole("button", { name: "Stop publishing" })).toHaveLength(1);
  fireEvent.click(within(steps).getByRole("button", { name: "Stop publishing" }));
  expect(mock.unpublish).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toBeDefined();
  fireEvent.click(within(dialog).getByRole("button", { name: "Stop publishing" }));
  expect(mock.unpublish).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

test("shows loading state while publishing and while stopping", async () => {
  let resolvePublish: () => void = () => {};
  mock.publish.mockReturnValue(
    new Promise<void>((resolve) => {
      resolvePublish = resolve;
    }),
  );
  await setup();
  fill("https://tandem.example.com", "eyJhIjoi");
  const publishBtn = screen.getByRole("button", { name: "Publish" });
  fireEvent.click(publishBtn);
  expect(screen.getByRole("button", { name: /Publishing…/ }).hasAttribute("disabled")).toBe(true);
  resolvePublish();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Publishing…/ })).toBeNull());
});

test("reports the reason a tunnel is not reachable", async () => {
  mock.state = {
    status: "failed",
    cloudflared: true,
    publicUrl: "https://tandem.example.com",
    message: "cloudflared exited with 255",
  };
  await setup();
  expect(screen.getByText("cloudflared exited with 255")).toBeDefined();
});
