import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const page = (name: string) => resolve(import.meta.dirname, `site/${name}.html`);

export default defineConfig({
  root: "site",
  plugins: [svelte()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page("index"),
        "how-it-works": page("how-it-works"),
        signup: page("signup"),
        app: page("app"),
      },
    },
  },
});
