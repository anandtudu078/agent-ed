import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Vite build configuration.
 *
 * The multi-page `input` is load-bearing, not tidiness. With no config Vite
 * builds `index.html` alone, so the other page is served fine by the dev server
 * (which serves any HTML file from the project root) but is silently omitted
 * from `dist/` — and the deployed site then 404s it forever, while local
 * testing passes. That is exactly the shape of bug a reviewer runs into on the
 * live URL and not locally.
 *
 * `index` is the landing page so the root URL is the landing page; `app` is the
 * tutor. The keys are the emitted filenames, which is why renaming the keys
 * would silently break the links between the two pages.
 *
 * `landing` is the old landing-page URL, kept as a redirect to `/` so links
 * already shared still resolve. It has no assets and exists only to survive the
 * build — drop it from here and it works perfectly in dev and 404s in
 * production, which is the failure mode described above.
 *
 * Adding a new page means adding it here too. The security suite asserts every
 * entry point survives a build.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app.html"),
        landing: resolve(__dirname, "landing.html"),
      },
    },
  },
});