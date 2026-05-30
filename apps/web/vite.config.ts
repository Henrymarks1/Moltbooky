import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@moltbooky/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
      "@moltbooky/db": fileURLToPath(new URL("../../packages/db/src", import.meta.url))
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
