import { TOKEN_QUERY_PARAMETER } from "@tandem/contracts";
import { startApp } from "./app.ts";
import { configureModelHttp } from "./http-setup.ts";
import { createFauxProvider, defaultProviders, demoReply } from "./models.ts";

/** In development the web app is served by Vite on another origin, which must be allowed and opened instead. */
const webOrigin = process.env.TANDEM_WEB_ORIGIN;
/** `TANDEM_FAUX=1` adds a local model that needs no credentials, slow enough to watch an answer stream and stop it. */
const faux = process.env.TANDEM_FAUX === "1";

configureModelHttp();
const server = await startApp({
  ...(webOrigin === undefined ? {} : { allowedOrigins: [webOrigin] }),
  providers: [...defaultProviders(), ...(faux ? [createFauxProvider({ tokensPerSecond: 40, reply: demoReply })] : [])],
  onError: (error) => console.error(error),
});
const openUrl = new URL(webOrigin ?? server.url);
openUrl.searchParams.set(TOKEN_QUERY_PARAMETER, server.token);
console.log(`Tandem server listening on ${server.url}`);
console.log(`Open ${openUrl}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.stop();
    process.exit(0);
  });
}
