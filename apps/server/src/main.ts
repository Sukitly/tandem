import { startServer } from "./server.ts";

const server = await startServer();
console.log(`Tandem server listening on ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.stop();
    process.exit(0);
  });
}
