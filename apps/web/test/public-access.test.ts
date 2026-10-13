// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Button } from "../src/components/ui/button.tsx";
import { PublicAccessDialogProvider, usePublicAccessDialog } from "../src/tunnel/public-access.tsx";

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
  const dialog = usePublicAccessDialog();
  return createElement(Button, { onClick: dialog.open }, "Open");
}

function setup() {
  render(createElement(PublicAccessDialogProvider, null, createElement(Open)));
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}

beforeEach(() => {
  mock.state = { status: "none", cloudflared: true };
  vi.clearAllMocks();
});
afterEach(cleanup);

test("publishes at the address the person typed", () => {
  mock.publish.mockResolvedValue(undefined);
  setup();
  fireEvent.change(screen.getByLabelText("The address it will answer at"), {
    target: { value: "https://tandem.example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect(mock.publish).toHaveBeenCalledWith("https://tandem.example.com", expect.anything());
});

test("does not ask Cloudflare for an address that is not HTTPS", () => {
  setup();
  fireEvent.change(screen.getByLabelText("The address it will answer at"), {
    target: { value: "http://tandem.example.com" },
  });
  expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  expect(mock.publish).not.toHaveBeenCalled();
});

test("says to install cloudflared rather than offering to publish", () => {
  mock.state = { status: "none", cloudflared: false };
  setup();
  expect(screen.getByText("cloudflared is not installed here")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
});

test("shows where to approve this machine while it waits", () => {
  mock.state = {
    status: "authorizing",
    cloudflared: true,
    publicUrl: "https://tandem.example.com",
    authorizationUrl: "https://dash.cloudflare.com/argotunnel?x=1",
  };
  setup();
  expect(screen.getByText("Open the Cloudflare approval page")).toBeDefined();
});

test("stops publishing only after asking", () => {
  mock.state = { status: "connected", cloudflared: true, publicUrl: "https://tandem.example.com" };
  mock.unpublish.mockResolvedValue(undefined);
  setup();
  expect(screen.getByText("https://tandem.example.com")).toBeDefined();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop publishing" }));
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
