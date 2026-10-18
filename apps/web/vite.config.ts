import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import {
  AUTH_PATH,
  BOOTSTRAP_PATH,
  DEFAULT_HOST,
  DEV_PORT,
  HEALTH_PATH,
  IMAGE_PATH,
  PREVIEW_PATH,
  PTY_PATH,
  RPC_PATH,
} from "@tandem/contracts";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = `http://${DEFAULT_HOST}:${DEV_PORT}`;

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
      [AUTH_PATH]: backend,
      [HEALTH_PATH]: backend,
      [BOOTSTRAP_PATH]: backend,
      [IMAGE_PATH]: backend,
      [RPC_PATH]: { target: backend, ws: true },
      [PTY_PATH]: { target: backend, ws: true },
      [PREVIEW_PATH]: { target: backend, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/@xterm/")) return "vendor-xterm";
          if (id.includes("node_modules/katex/")) return "vendor-katex";
          if (id.includes("node_modules/@pierre/diffs/")) return "vendor-diffs";
          if (id.includes("node_modules/mermaid/") || id.includes("node_modules/@streamdown/mermaid/"))
            return "vendor-mermaid";
          if (id.includes("node_modules/streamdown/") || id.includes("node_modules/@streamdown/"))
            return "vendor-streamdown";
          if (id.includes("node_modules/@tanstack/")) return "vendor-tanstack";
        },
      },
    },
  },
});
