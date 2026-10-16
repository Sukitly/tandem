// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DevicesDialogProvider, useDevicesDialog } from "../src/auth/devices-dialog.tsx";
import { Button } from "../src/components/ui/button.tsx";

const mock = vi.hoisted(() => {
  const device = { id: "self", name: "Laptop", createdAt: 0, lastSeenAt: 0 };
  const other = { id: "phone", name: "Phone", createdAt: 0, lastSeenAt: 0 };
  return {
    device,
    other,
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
  mock.value.devices = [mock.device];
  vi.clearAllMocks();
});
afterEach(cleanup);

test("lists devices, and revokes another one only after asking", async () => {
  mock.value.devices = [mock.device, mock.other];
  mock.revoke.mockResolvedValue(undefined);
  setup();
  expect(screen.getByText("This device")).toBeDefined();
  expect(screen.getByText("Phone")).toBeDefined();
  // Only the other device is revocable here: removing this browser is signing out.
  expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(mock.revoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(mock.revoke).toHaveBeenCalled());
  expect(mock.revoke.mock.calls[0]?.[0]).toBe("phone");
});
test("with one device there is nothing to revoke, and so no button for it", () => {
  setup();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Revoke other devices" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
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
  fireEvent.click(screen.getByRole("button", { name: "Replace recovery codes" }));
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

test("says what replacing does when codes already exist", () => {
  setup();
  expect(screen.getByRole("button", { name: "Replace recovery codes" }).classList.contains("text-destructive")).toBe(
    true,
  );
  expect(screen.getByText(/makes every code you have saved stop working/)).toBeDefined();
});
test("offers primary generation without confirmation when no code exists", async () => {
  mock.value.recoveryCodesRemaining = 0;
  mock.regenerateRecoveryCodes.mockResolvedValue(["new-code"]);
  render(createElement(DevicesDialogProvider, null, createElement(OpenDevices)));
  // With none saved, the dialog that asks for them opens first; its action opens this one.
  fireEvent.click(screen.getByRole("button", { name: "Manage devices and recovery codes" }));
  const generate = screen.getByRole("button", { name: "Generate recovery codes" });
  expect(generate.classList.contains("bg-primary")).toBe(true);
  expect(generate.classList.contains("text-destructive")).toBe(false);
  expect(screen.queryByText(/makes every code you have saved stop working/)).toBeNull();
  fireEvent.click(generate);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() => expect(screen.getByText("new-code")).toBeDefined());
  expect(mock.regenerateRecoveryCodes).toHaveBeenCalledOnce();
});
