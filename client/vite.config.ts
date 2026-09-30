import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Vite build configuration.
 *
 * The multi-page `input` is load-bearing, not tidiness. With no config Vite
 * builds `index.html` alone, so `landing.html` is served fine by the dev server
 * (which serves any HTML file from the project root) but is silently omitted
 * from `dist/` — and the deployed site then 404s it forever, while local
 * testing passes. That is exactly the shape of bug a reviewer runs into on the
 * live URL and not locally.
 *
 * Adding a new page means adding it here too. The security suite asserts both
 * entry points survive a build.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        landing: resolve(__dirname, "landing.html"),
      },
    },
  },
});