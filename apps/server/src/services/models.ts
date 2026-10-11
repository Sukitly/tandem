import { type MutableReplicatedState, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  type AuthEvent,
  type AuthPrompt,
  type AuthType,
  type CredentialStore,
  getSupportedThinkingLevels,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import type {
  LoginEvent,
  LoginPrompt,
  LoginState,
  ModelRef,
  ModelSummary,
  ModelsState,
  ProviderSummary,
} from "@tandem/contracts";
import type { Settings } from "../settings.ts";
import { invalidInput } from "./errors.ts";

/** The name Tandem introduces itself with during OAuth logins. */
const AGENT_NAME = "Tandem";

interface RunningLogin {
  readonly id: number;
  readonly abort: AbortController;
  pendingPrompt?: { id: number; resolve(value: string): void; reject(error: Error): void };
}

/**
 * Providers, credentials, and available models, shared by every connection. Logins run here, on the server: the
 * browser only shows the flow's events and answers its prompts, and credentials never reach it.
 */
export class ModelCatalog {
  readonly #models: MutableModels;
  readonly #credentials: CredentialStore;
  readonly #settings: Settings;
  readonly #state: MutableReplicatedState<ModelsState>;
  #login: RunningLogin | undefined;
  #nextLoginId = 1;
  #nextPromptId = 1;

  private constructor(models: MutableModels, credentials: CredentialStore, settings: Settings, initial: ModelsState) {
    this.#models = models;
    this.#credentials = credentials;
    this.#settings = settings;
    this.#state = replicatedState(initial);
  }

  /** `models` must use `credentials`, so that the catalog can tell stored credentials from the environment's. */
  static async load(models: MutableModels, credentials: CredentialStore, settings: Settings): Promise<ModelCatalog> {
    const catalog = new ModelCatalog(models, credentials, settings, { providers: [], models: [] });
    await catalog.recompute();
    // Dynamic providers fetch their model lists over the network; startup does not wait for them.
    void catalog.refresh().catch(() => {});
    return catalog;
  }

  get state(): MutableReplicatedState<ModelsState> {
    return this.#state;
  }

  /** The model new conversations start with: the chosen default while it is available, else the first available. */
  defaultModel(): ModelRef | undefined {
    const { models, defaultModel } = this.#state.value;
    return (
      defaultModel ??
      (models[0] === undefined ? undefined : { provider: models[0].provider, modelId: models[0].modelId })
    );
  }

  /** The model, if a configured provider offers it. */
  available(ref: ModelRef): Model<string> | undefined {
    const listed = this.#state.value.models.some(
      (model) => model.provider === ref.provider && model.modelId === ref.modelId,
    );
    return listed ? this.#models.getModel(ref.provider, ref.modelId) : undefined;
  }

  /** Fetch dynamic providers' model lists, then recompute. */
  async refresh(): Promise<void> {
    await this.#models.refresh();
    await this.recompute();
  }

  /** Recompute providers' sign-in status and the available models from what is known now. */
  async recompute(): Promise<void> {
    const stored = new Set((await this.#credentials.list()).map((info) => info.providerId));
    const providers: ProviderSummary[] = [];
    for (const provider of this.#models.getProviders()) {
      const check = await this.#models.checkAuth(provider.id).catch(() => undefined);
      const login: ProviderSummary["login"] = [];
      if (provider.auth.oauth !== undefined) {
        login.push({ type: "oauth", label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name });
      }
      if (provider.auth.apiKey?.login !== undefined) login.push({ type: "api_key", label: provider.auth.apiKey.name });
      providers.push({
        id: provider.id,
        name: provider.name,
        login,
        stored: stored.has(provider.id),
        ...(check === undefined
          ? {}
          : { configured: { type: check.type, ...(check.source === undefined ? {} : { source: check.source }) } }),
      });
    }
    providers.sort((a, b) => a.name.localeCompare(b.name));
    const models = (await this.#models.getAvailable().catch(() => [])).map(toSummary);
    const chosen = this.#settings.value.defaultModel;
    const defaultModel =
      chosen !== undefined &&
      models.some((model) => model.provider === chosen.provider && model.modelId === chosen.modelId)
        ? chosen
        : undefined;
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.providers = providers;
      draft.models = models;
      if (defaultModel === undefined) delete draft.defaultModel;
      else draft.defaultModel = defaultModel;
    });
  }

  async setDefaultModel(ref: ModelRef): Promise<void> {
    if (this.available(ref) === undefined) throw invalidInput(`Model is not available: ${ref.provider}/${ref.modelId}`);
    const defaultModel = { provider: ref.provider, modelId: ref.modelId };
    await this.#settings.update({ defaultModel });
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.defaultModel = defaultModel;
    });
  }

  /** Start a login flow; it runs in the background and reports through `state.login`. */
  login(providerId: string, type: AuthType): number {
    const provider = this.#models.getProvider(providerId);
    if (provider === undefined) throw invalidInput(`Unknown provider: ${providerId}`);
    if (type === "oauth" ? provider.auth.oauth === undefined : provider.auth.apiKey?.login === undefined) {
      throw invalidInput(`${provider.name} has no ${type === "oauth" ? "OAuth" : "API key"} login`);
    }
    this.cancelLogin();
    const login: RunningLogin = { id: this.#nextLoginId++, abort: new AbortController() };
    this.#login = login;
    this.#setLogin({ id: login.id, providerId, providerName: provider.name, type, status: "running", events: [] });

    const update = (change: (draft: LoginState) => void): void => {
      if (this.#login !== login) return;
      this.#state.change(BACKGROUND_CONTEXT, (draft) => {
        if (draft.login !== undefined) change(draft.login);
      });
    };
    void this.#models
      .login(
        providerId,
        type,
        {
          signal: login.abort.signal,
          notify: (event) => update((draft) => void draft.events.push(toLoginEvent(event))),
          prompt: (prompt) => this.#ask(login, prompt, update),
        },
        { agentName: AGENT_NAME, getDeviceId: () => this.#settings.deviceId() },
      )
      .then(
        async () => {
          await this.refresh();
          update((draft) => {
            draft.status = "succeeded";
            delete draft.prompt;
          });
        },
        (error: unknown) =>
          update((draft) => {
            draft.status = login.abort.signal.aborted ? "cancelled" : "failed";
            delete draft.prompt;
            if (!login.abort.signal.aborted) draft.error = error instanceof Error ? error.message : String(error);
          }),
      )
      .finally(() => {
        if (this.#login === login) this.#login = undefined;
      });
    return login.id;
  }

  answerLogin(promptId: number, value: string): void {
    const pending = this.#login?.pendingPrompt;
    if (pending === undefined || pending.id !== promptId)
      throw invalidInput("The login is not waiting for this answer");
    pending.resolve(value);
  }

  cancelLogin(): void {
    const login = this.#login;
    if (login === undefined) return;
    login.pendingPrompt?.reject(new Error("Login cancelled"));
    login.abort.abort();
  }

  async logout(providerId: string): Promise<void> {
    if (this.#models.getProvider(providerId) === undefined) throw invalidInput(`Unknown provider: ${providerId}`);
    await this.#models.logout(providerId);
    await this.recompute();
  }

  #ask(
    login: RunningLogin,
    prompt: AuthPrompt,
    update: (change: (draft: LoginState) => void) => void,
  ): Promise<string> {
    const id = this.#nextPromptId++;
    const view: LoginPrompt =
      prompt.type === "select"
        ? { id, type: "select", message: prompt.message, options: prompt.options.map((option) => ({ ...option })) }
        : {
            id,
            type: prompt.type,
            message: prompt.message,
            ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
          };
    return new Promise<string>((resolve, reject) => {
      const clear = (): void => {
        if (login.pendingPrompt?.id === id) login.pendingPrompt = undefined;
        update((draft) => {
          if (draft.prompt?.id === id) delete draft.prompt;
        });
      };
      login.pendingPrompt = {
        id,
        resolve: (value) => {
          clear();
          resolve(value);
        },
        reject: (error) => {
          clear();
          reject(error);
        },
      };
      // The flow withdraws a prompt when something else answered it, such as the OAuth callback.
      prompt.signal?.addEventListener(
        "abort",
        () => login.pendingPrompt?.id === id && login.pendingPrompt.reject(new Error("Prompt withdrawn")),
        {
          once: true,
        },
      );
      update((draft) => {
        draft.prompt = view;
      });
    });
  }

  #setLogin(login: LoginState): void {
    this.#state.change(BACKGROUND_CONTEXT, (draft) => {
      draft.login = login;
    });
  }
}

function toSummary(model: Model<string>): ModelSummary {
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    thinkingLevels: getSupportedThinkingLevels(model),
    contextWindow: model.contextWindow,
  };
}

function toLoginEvent(event: AuthEvent): LoginEvent {
  switch (event.type) {
    case "info":
      return {
        type: "info",
        message: event.message,
        ...(event.links === undefined ? {} : { links: event.links.map((link) => ({ ...link })) }),
      };
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
      };
    case "device_code":
      return { type: "device_code", userCode: event.userCode, verificationUri: event.verificationUri };
    case "progress":
      return { type: "progress", message: event.message };
  }
}
