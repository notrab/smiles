/*
 * What a Bunny Edge Script gets from its runtime. Everything else, the SDK and
 * the database client included, comes from npm and is bundled by the build.
 */

declare const Deno: {
  env: { get(name: string): string | undefined };
};

/** Replaced at build time with the bundled browser widget (scripts/build.mjs). */
declare const __WIDGET_SOURCE__: string;
