import { config, configured } from "./config";

/** What the widget script puts on the page once it has loaded. */
declare global {
  interface Window {
    Smiles?: {
      onVote(fn: (payload: unknown) => void): void;
      inline(root: HTMLElement, options?: { question?: string }): HTMLElement;
      tab(options?: { question?: string; label?: string }): HTMLElement;
    };
  }
}

/** Load the widget from its Edge Script, once per page. */
export function loadWidget(params: Record<string, string> = {}): Promise<void> {
  if (!configured) return Promise.resolve();
  if (document.querySelector("script[data-smiles-widget]")) return Promise.resolve();

  return new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = `${config.widget}/${config.site}.js?${new URLSearchParams(params)}`;
    tag.async = true;
    tag.dataset.smilesWidget = "";
    tag.onload = () => resolve();
    tag.onerror = () => resolve();
    document.head.appendChild(tag);
  });
}
