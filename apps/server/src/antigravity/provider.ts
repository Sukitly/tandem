import { createProvider, type Provider } from "@earendil-works/pi-ai";
import { fetchAvailableModelsCatalog, parseApiKey } from "./client.ts";
import { ANTIGRAVITY_MODELS, PROVIDER_ID, PROVIDER_NAME } from "./models.ts";
import { getApiKey, loginAntigravity, refreshAntigravityToken } from "./oauth.ts";
import { streamAntigravity } from "./stream.ts";

export function antigravityProvider(): Provider {
  return createProvider({
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    baseUrl: "https://daily-cloudcode-pa.googleapis.com",
    auth: {
      oauth: {
        name: PROVIDER_NAME,
        loginLabel: "Sign in with Google",
        isSubscription: true,
        login: loginAntigravity,
        refresh: refreshAntigravityToken,
        toAuth: async (credential) => ({
          apiKey: getApiKey(credential),
        }),
      },
    },
    models: ANTIGRAVITY_MODELS,
    fetchModels: async (context) => {
      const apiKey = context.credential?.type === "oauth" ? getApiKey(context.credential) : undefined;
      if (!apiKey || context.signal.aborted) return ANTIGRAVITY_MODELS;
      try {
        const creds = parseApiKey(apiKey);
        const available = await fetchAvailableModelsCatalog(creds.token, creds.projectId, context.signal);
        const models = available.data.models;
        if (!models || Object.keys(models).length === 0) return ANTIGRAVITY_MODELS;
        return ANTIGRAVITY_MODELS;
      } catch {
        return ANTIGRAVITY_MODELS;
      }
    },
    api: {
      stream: (model, context, options) => streamAntigravity(model, context, options),
      streamSimple: (model, context, options) => streamAntigravity(model, context, options),
    },
  });
}
