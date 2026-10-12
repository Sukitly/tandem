import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export type AuthType = "oauth" | "api_key";

export interface ProviderSummary {
  id: string;
  name: string;
  /** The ways to sign in. A provider without any is configured from the environment only. */
  login: { type: AuthType; label: string }[];
  /** Present when the provider can be used; `source` says where its credential comes from. */
  configured?: { type: AuthType; source?: string };
  /** A credential Tandem stores, which `logout()` removes. Credentials from the environment are not stored. */
  stored: boolean;
}

export interface ModelSummary extends ModelRef {
  name: string;
  /** Thinking levels the model supports; `["off"]` when it does not reason. */
  thinkingLevels: string[];
  contextWindow: number;
  /** Present when the model takes images: at most this many in one message, if it says. */
  images?: { maxPerMessage?: number };
}

/** What a login flow shows. Events accumulate; the prompt is the one question waiting for an answer. */
export type LoginEvent =
  | { type: "info"; message: string; links?: { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "progress"; message: string };

export type LoginPrompt = { id: number; message: string; placeholder?: string } & (
  | { type: "text" | "secret" | "manual_code" }
  | { type: "select"; options: { id: string; label: string; description?: string }[] }
);

export interface LoginState {
  id: number;
  providerId: string;
  providerName: string;
  type: AuthType;
  status: "running" | "succeeded" | "failed" | "cancelled";
  events: LoginEvent[];
  prompt?: LoginPrompt;
  error?: string;
}

export interface ModelsState {
  providers: ProviderSummary[];
  /** Models of configured providers. */
  models: ModelSummary[];
  /** The model new conversations start with. */
  defaultModel?: ModelRef;
  /** The current or last login flow. One runs at a time. */
  login?: LoginState;
}

/** Providers, their credentials, and the models they make available. Credentials never leave the server. */
export interface Models {
  readonly state: ReplicatedState<ModelsState>;
  /** Start a login flow and return its ID. Follow it in `state.login`; a running flow is cancelled first. */
  login(input: { providerId: string; type: AuthType }, context: Context): Promise<number>;
  /** Answer the prompt the login flow is waiting on. */
  answerLogin(input: { promptId: number; value: string }, context: Context): Promise<void>;
  cancelLogin(context: Context): Promise<void>;
  /** Remove the provider's stored credential. */
  logout(providerId: string, context: Context): Promise<void>;
  setDefaultModel(model: ModelRef, context: Context): Promise<void>;
}

export const Models = defineService<Models>("tandem.models");
