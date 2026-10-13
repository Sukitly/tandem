// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DevicesDialogProvider, useDevicesDialog } from "../src/auth/devices-dialog.tsx";
import { Button } from "../src/components/ui/button.tsx";

const mock = vi.hoisted(() => {
  const device = { id: "self", name: "Laptop", createdAt: 0, lastSeenAt: 0 };
  return {
    device,
    value: { devices: [device], recoveryCodesRemaining: 10 },
    addDevice: vi.fn(),
    revoke: vi.fn(),
    rename: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
  };
});
vi.mock("../src/rpc/connection.tsx", () => ({
  useConnected: () => ({
    deviceId: "self",
    devices: {
      state: mock.value,
      addDevice: mock.addDevice,
      revoke: mock.revoke,
      rename: mock.rename,
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
  mock.device.name = "Laptop";
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

test("renames a device, and takes the new name from the subscription state", async () => {
  mock.rename.mockImplementation(async (_id: string, name: string) => {
    mock.device.name = name;
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("Name of Laptop"), { target: { value: "Phone" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mock.rename).toHaveBeenCalledWith("self", "Phone", expect.anything()));
  await waitFor(() => expect(mock.rename).toHaveBeenCalledWith("self", "Phone", expect.anything()));
  await waitFor(() => expect(screen.getByText("Phone")).toBeDefined());
  // The name comes from the subscription state, so the row leaves editing on its own.
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
test("a failed rename keeps the typed name and says why", async () => {
  mock.rename.mockRejectedValue(new Error("Device does not exist"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("Name of Laptop"), { target: { value: "Phone" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByText("Device does not exist")).toBeDefined());
  expect((screen.getByLabelText("Name of Laptop") as HTMLInputElement).value).toBe("Phone");
});
