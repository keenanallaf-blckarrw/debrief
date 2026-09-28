import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The companion (server/) listens here. In development Vite forwards /api calls to
// it, so the app and the companion behave like one site.
const COMPANION_PORT = Number(process.env.DEBRIEF_PORT || 4317);

export default defineConfig({
  // "/" when the companion serves the app on your computer. The GitHub Pages copy
  // lives at /debrief/, so `npm run build:pages` sets BASE_PATH=/debrief/.
  base: process.env.BASE_PATH || "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://127.0.0.1:${COMPANION_PORT}`, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
