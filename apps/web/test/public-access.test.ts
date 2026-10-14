// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PublicAccessPageProvider, usePublicAccessPage } from "../src/tunnel/public-access.tsx";

const mock = vi.hoisted(() => ({
  state: { status: "none", cloudflared: true } as Record<string, unknown>,
  publish: vi.fn(),
  unpublish: vi.fn(),
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({ publicAccess: { state: mock.state, publish: mock.publish, unpublish: mock.unpublish } }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));

function Open() {
  const page = usePublicAccessPage();
  return createElement("a", page, "Open");
}

function setup() {
  render(createElement(PublicAccessPageProvider, null, createElement(Open)));
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
}

function fill(address: string, token: string) {
  fireEvent.change(screen.getByLabelText("The address it will answer at"), { target: { value: address } });
  fireEvent.change(screen.getByLabelText("Tunnel token"), { target: { value: token } });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  mock.state = { status: "none", cloudflared: true };
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

test("opens a dedicated page from a real link and returns to the original conversation", () => {
  window.history.replaceState(null, "", "/#42");
  render(createElement(PublicAccessPageProvider, null, createElement(Open)));
  expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/#public-access");
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: "Public access" })).toBeDefined();
  expect(screen.getByRole("link", { name: "Back to workspace" }).getAttribute("href")).toBe("/#42");
  fireEvent.click(screen.getByRole("link", { name: "Back to workspace" }));
  expect(window.location.hash).toBe("#42");
  expect(screen.getByRole("link", { name: "Open" })).toBeDefined();
});

test("opens directly from its URL and follows browser navigation", () => {
  window.history.replaceState(null, "", "/#public-access");
  render(createElement(PublicAccessPageProvider, null, createElement(Open)));
  expect(screen.getByRole("main", { name: "Public access" })).toBeDefined();
  window.history.replaceState(null, "", "/");
  fireEvent.popState(window);
  expect(screen.queryByRole("main", { name: "Public access" })).toBeNull();
});

test.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])(
  "leaves modified link clicks to the browser: %j",
  (modifiers) => {
    render(createElement(PublicAccessPageProvider, null, createElement(Open)));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
    fireEvent(screen.getByRole("link", { name: "Open" }), event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("main", { name: "Public access" })).toBeNull();
  },
);

test("walks the website path in order, saying where each step happens and what it looks like when done", () => {
  setup();
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

test("says the token comes from the manual command, without running it", () => {
  setup();
  expect(screen.getByText(/The value after --token, not the whole command/)).toBeDefined();
});

test("publishes the address and the token the person entered", () => {
  mock.publish.mockResolvedValue(undefined);
  setup();
  fill("https://tandem.example.com", "eyJhIjoi");
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(mock.publish).toHaveBeenCalledWith(
    { publicUrl: "https://tandem.example.com", token: "eyJhIjoi" },
    expect.anything(),
  );
});

test("automatically extracts token if user pastes the full cloudflared run command", () => {
  mock.publish.mockResolvedValue(undefined);
  setup();
  fill("https://tandem.example.com", "cloudflared tunnel run --token eyJhbGciOiJIUzI1NiJ9");
  expect((screen.getByLabelText("Tunnel token") as HTMLInputElement).value).toBe("eyJhbGciOiJIUzI1NiJ9");
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(mock.publish).toHaveBeenCalledWith(
    { publicUrl: "https://tandem.example.com", token: "eyJhbGciOiJIUzI1NiJ9" },
    expect.anything(),
  );
});

test("refuses to publish without HTTPS or without a token", () => {
  setup();
  fill("http://tandem.example.com", "eyJhIjoi");
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  fill("https://tandem.example.com", "");
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  expect(mock.publish).not.toHaveBeenCalled();
});

test("names Cloudflare Access as a step, with the hostname it protects", () => {
  setup();
  expect(screen.getByText("A connected tunnel is not a login")).toBeDefined();
  expect(screen.getByText(/Never/).textContent).toContain("Bypass");
  expect(screen.getByRole("link", { name: "Open Cloudflare Access applications" }).getAttribute("href")).toBe(
    "https://one.dash.cloudflare.com/?to=/:account/access-controls/apps",
  );
  expect(screen.getByText("Self-hosted")).toBeDefined();
  expect(screen.getByText("A different, unlisted email is refused.")).toBeDefined();
});

test("directly jumps to the specific tunnel routes and access pages when tunnel identity is known", () => {
  mock.state = {
    status: "connected",
    cloudflared: true,
    publicUrl: "https://tandem.example.com",
    tunnel: { accountId: "1234567890abcdef1234567890abcdef", tunnelId: "c4648dd8-acd3-48f5-9004-3f3dc20192c2" },
  };
  setup();
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

test("walks the CLI path on this machine, and on another computer with only a token", () => {
  setup();
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

test("keeps the entered token when the setup method changes", () => {
  setup();
  fill("https://tandem.example.com", "saved-token");
  fireEvent.click(screen.getByRole("tab", { name: "CLI" }));
  fireEvent.click(screen.getByRole("tab", { name: "Cloudflare website" }));
  expect((screen.getByLabelText("Tunnel token") as HTMLInputElement).value).toBe("saved-token");
});

test("shows how to install cloudflared and blocks publishing without it", () => {
  mock.state = { status: "none", cloudflared: false };
  setup();
  expect(screen.getByRole("heading", { name: "Install cloudflared on the host" })).toBeDefined();
  expect(screen.getByText("brew install cloudflared")).toBeDefined();
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
});

test("reports a connected tunnel, replaces the publish form, and offers to stop", () => {
  mock.state = { status: "connected", cloudflared: true, publicUrl: "https://tandem.example.com" };
  mock.unpublish.mockResolvedValue(undefined);
  setup();
  expect(screen.getByText(/Tunnel connected for/)).toBeDefined();
  expect(screen.getByText(/The address only reaches it once you finish the route and Access steps/)).toBeDefined();
  expect(screen.queryByLabelText("Tunnel token")).toBeNull();
  expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  const steps = screen.getByRole("list", { name: "Cloudflare website setup steps" });
  expect(within(steps).getByText(/This machine is already connected/)).toBeDefined();
  expect(screen.getAllByRole("button", { name: "Stop publishing" })).toHaveLength(1);
  fireEvent.click(within(steps).getByRole("button", { name: "Stop publishing" }));
  expect(mock.unpublish).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Stop publishing" }));
  expect(mock.unpublish).toHaveBeenCalled();
});

test("reports the reason a tunnel is not reachable", () => {
  mock.state = {
    status: "failed",
    cloudflared: true,
    publicUrl: "https://tandem.example.com",
    message: "cloudflared exited with 255",
  };
  setup();
  expect(screen.getByText("cloudflared exited with 255")).toBeDefined();
});
