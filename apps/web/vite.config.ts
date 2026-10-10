import { DEFAULT_HOST, DEFAULT_PORT, HEALTH_PATH, PTY_PATH, RPC_PATH } from "@tandem/contracts";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: DEFAULT_HOST,
    proxy: {
      [HEALTH_PATH]: backend,
      [RPC_PATH]: { target: backend, ws: true },
      [PTY_PATH]: { target: backend, ws: true },
    },
  },
});
