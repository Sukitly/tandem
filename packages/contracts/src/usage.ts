import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

/** One rate-limit window of a provider, as the usage widget shows it. */
export interface UsageWindow {
  /** Short name of the window: `5h`, `7d`, `30m`, or the provider's own duration. */
  label: string;
  /** The used share, in percent. */
  utilization: number;
  /** When the window resets, as an ISO string; absent when the provider did not say. */
  resetsAt?: string;
  /** The window's length in seconds; the page measures the pace against it. */
  windowSeconds: number;
}

/** What is known of one provider's usage. */
export interface ProviderUsage {
  /** The provider this describes. */
  provider: string;
  /** The provider's windows, in the order they are shown; empty when it has none. */
  windows: UsageWindow[];
  /** Shown instead of windows when the provider has no quota API, such as a native OpenAI subscription. */
  notice?: string;
  /** Why the last read failed, sanitized for display; earlier windows stay. */
  error?: string;
  /** Milliseconds since the epoch of the last successful read. */
  refreshedAt?: number;
}

export interface UsageState {
  /** What is known, by provider id. A provider that has not been read is absent. */
  providers: Record<string, ProviderUsage>;
}

/**
 * Every provider's rate-limit usage. The server reads it, because the credentials it needs never reach a page; a page
 * calls `refresh` when the provider it shows changes or a run ends, and renders what the state holds.
 */
export interface Usage {
  readonly state: ReplicatedState<UsageState>;
  /** Read the provider's usage. `force` reads even when a recent successful one stands. */
  refresh(provider: string, force: boolean, context: Context): Promise<void>;
}

export const Usage = defineService<Usage>("tandem.usage");
