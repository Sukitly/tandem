// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DevicesDialogProvider, useDevicesDialog } from "../src/auth/devices-dialog.tsx";
import { Button } from "../src/components/ui/button.tsx";

const mock = vi.hoisted(() => ({
  value: { devices: [{ id: "self", name: "Laptop", createdAt: 0, lastSeenAt: 0 }], recoveryCodesRemaining: 10 },
  addDevice: vi.fn(),
  revoke: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    deviceId: "self",
    devices: {
      state: mock.value,
      addDevice: mock.addDevice,
      revoke: mock.revoke,
      regenerateRecoveryCodes: mock.regenerateRecoveryCodes,
    },
  }),
}));
vi.mock("../src/rpc/use-replicated-state.ts", () => ({ useReplicatedState: (state: unknown) => state }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr") } }));
function OpenDevices() {
  const dialog = useDevicesDialog();
  return createElement(Button, { onClick: dialog.open }, "Open devices");
}
function setup() {
  render(createElement(DevicesDialogProvider, null, createElement(OpenDevices)));
  fireEvent.click(screen.getByRole("button", { name: "Open devices" }));
}
beforeEach(() => {
  mock.value.recoveryCodesRemaining = 10;
  vi.clearAllMocks();
});
afterEach(cleanup);

test("lists devices from subscription state and asks before revoking", async () => {
  mock.revoke.mockResolvedValue(undefined);
  setup();
  expect(screen.getByText("This device")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(mock.revoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(mock.revoke).toHaveBeenCalled());
  expect(mock.revoke.mock.calls[0]?.[0]).toBe("self");
});
test("add device shows a fragment link and QR code for the configured public origin", async () => {
  mock.addDevice.mockResolvedValue({
    code: "pair-code",
    expiresAt: Date.now() + 300000,
    publicUrl: "https://tandem.example.com",
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add device" }));
  await waitFor(() => expect(screen.getByAltText("Scan to pair another device")).toBeDefined());
  expect((screen.getByLabelText("Pairing link") as HTMLInputElement).value).toBe(
    "https://tandem.example.com/pair#pair-code",
  );
});
test("action failures are shown in the dialog", async () => {
  mock.addDevice.mockRejectedValue(new Error("Too many pending links"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add device" }));
  await waitFor(() => expect(screen.getByText("Too many pending links")).toBeDefined());
});
test("replacing recovery codes requires confirmation and the secrets disappear when the dialog closes", async () => {
  mock.regenerateRecoveryCodes.mockResolvedValue(["saved-once"]);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Generate recovery codes" }));
  expect(mock.regenerateRecoveryCodes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.getByText("saved-once")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByText("saved-once")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Open devices" }));
  expect(screen.queryByText("saved-once")).toBeNull();
});
