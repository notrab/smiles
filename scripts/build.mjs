/*
 * Builds both Edge Scripts into dist/, with node and esbuild. No deno needed.
 *
 *   node scripts/build.mjs        (or: npm run build)
 *
 * Everything comes from npm, so each script bundles into one self-contained
 * file with nothing to resolve at runtime.
 */
import { build } from "esbuild";

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  // Edge Scripting is a Deno runtime, so prefer each package's deno build.
  conditions: ["deno", "worker", "browser", "import"],
  legalComments: "none",
  logLevel: "info",
};

/*
 * The widget people embed is built first, on its own: it runs in a visitor's
 * browser, not on the edge, so it ships as one minified IIFE that the widget
 * Edge Script serves as text.
 */
const client = await build({
  ...common,
  entryPoints: ["widget/src/client/index.ts"],
  format: "iife",
  minify: true,
  write: false,
});

const widgetSource = client.outputFiles[0].text;

await build({
  ...common,
  entryPoints: ["api/src/main.ts"],
  outfile: "dist/api.js",
});

await build({
  ...common,
  entryPoints: ["widget/src/main.ts"],
  outfile: "dist/widget.js",
  define: { __WIDGET_SOURCE__: JSON.stringify(widgetSource) },
});

console.log(`\nwidget payload: ${(widgetSource.length / 1024).toFixed(1)} KB`);
