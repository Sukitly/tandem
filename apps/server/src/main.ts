import { TOKEN_QUERY_PARAMETER } from "@tandem/contracts";
import { startApp } from "./app.ts";

const server = await startApp({ onError: (error) => console.error(error) });
const openUrl = new URL(server.url);
openUrl.searchParams.set(TOKEN_QUERY_PARAMETER, server.token);
console.log(`Tandem server listening on ${server.url}`);
console.log(`Open ${openUrl}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.stop();
    process.exit(0);
  });
}
