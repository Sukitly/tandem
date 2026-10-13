import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

export const AUTH_PATH = "/auth";
export const PAIR_PATH = `${AUTH_PATH}/pair`;
export const PAIR_CODE_PATH = `${AUTH_PATH}/code`;
export const SIGN_OUT_PATH = `${AUTH_PATH}/sign-out`;

export type DeviceSummary = { id: string; name: string; createdAt: number; lastSeenAt: number };
export type DevicesState = { devices: DeviceSummary[]; recoveryCodesRemaining: number };
export type PairingCode = { code: string; expiresAt: number; publicUrl?: string };

/** Every paired device belongs to the installation's owner and has the same permissions. */
export interface Devices {
  readonly state: ReplicatedState<DevicesState>;
  addDevice(context: Context): Promise<PairingCode>;
  rename(id: string, name: string, context: Context): Promise<void>;
  revoke(id: string, context: Context): Promise<void>;
  revokeOthers(keepId: string, context: Context): Promise<void>;
  regenerateRecoveryCodes(context: Context): Promise<string[]>;
}
export const Devices = defineService<Devices>("tandem.devices");
