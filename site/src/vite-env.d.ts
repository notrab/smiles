/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SMILES_API?: string;
  readonly VITE_SMILES_WIDGET?: string;
  readonly VITE_SMILES_SITE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
