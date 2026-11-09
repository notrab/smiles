export interface SiteConfig {
  api: string;
  widget: string;
  site: string;
}

const trim = (value: string | undefined) => (value ?? "").replace(/\/+$/, "");

// Written into site/.env by scripts/setup.sh and baked in at build time, so the
// values ride in a content-hashed bundle and can never be served stale.
export const config: SiteConfig = {
  api: trim(import.meta.env.VITE_SMILES_API),
  widget: trim(import.meta.env.VITE_SMILES_WIDGET),
  site: import.meta.env.VITE_SMILES_SITE || "demo",
};

/** False until scripts/setup.sh has filled in site/.env. */
export const configured = Boolean(config.api && config.widget);
