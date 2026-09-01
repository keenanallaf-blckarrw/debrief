import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed to GitHub Pages at https://<user>.github.io/debrief/, so assets must
// be requested from /debrief/ rather than the domain root. Building for any other
// host (Vercel, Netlify, a custom domain) means setting BASE_PATH=/ instead.
const base = process.env.BASE_PATH ?? "/debrief/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
