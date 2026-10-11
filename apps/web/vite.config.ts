import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { BOOTSTRAP_PATH, DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH, PTY_PATH, RPC_PATH } from "@tandem/contracts";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: DEFAULT_HOST,
    // The server's development script allows this origin; see apps/server/package.json.
    port: 5173,
    strictPort: true,
    proxy: {
      [HEALTH_PATH]: backend,
      [BOOTSTRAP_PATH]: backend,
      [RPC_PATH]: { target: backend, ws: true },
      [PTY_PATH]: { target: backend, ws: true },
    },
  },
});
