import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

export const AUTH_PATH = "/auth";
export const PAIR_PATH = `${AUTH_PATH}/pair`;
export const PAIR_CODE_PATH = `${AUTH_PATH}/code`;
/** Asks the server on a port to prove it holds this installation's key, so a launcher never sends the key first. */
export const PROOF_PATH = `${AUTH_PATH}/proof`;
export const SIGN_OUT_PATH = `${AUTH_PATH}/sign-out`;

export type DeviceSummary = { id: string; name: string; createdAt: number; lastSeenAt: number };
export type DevicesState = { devices: DeviceSummary[]; recoveryCodesRemaining: number };
/** A launcher's nonce, and the server's answer: its identity and `HMAC-SHA256` of that nonce under the master key. */
export type ProofRequest = { nonce: string };
export type ProofResponse = { serverId: string; proof: string };

export type PairingCode = {
  code: string;
  expiresAt: number;
  /** The public origin, when one is configured. */
  publicUrl?: string;
  /** Where a browser opens the page, when that is not this server's own origin, as in development. */
  entry?: string;
};

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
