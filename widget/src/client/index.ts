import { config } from "./types";
import type { Stats, WidgetOptions } from "./types";
import { mount, onVote, tab } from "./widget";

const Smiles = {
  site: config.site,
  api: config.api,
  onVote,
  tab,
  inline: (root: HTMLElement, options: WidgetOptions = {}) => mount(root, options),
  stats: (): Promise<Stats> =>
    fetch(`${config.api}/v1/stats/${config.site}`).then((res) => res.json() as Promise<Stats>),
  boot(): void {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-smiles]"))) {
      if (node.getAttribute("data-smiles-ready")) continue;
      node.setAttribute("data-smiles-ready", "1");
      mount(node);
    }
    if (config.tab) tab({ question: config.tab === true ? config.question : config.tab });
  },
};

window.Smiles = Smiles;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", Smiles.boot);
} else {
  Smiles.boot();
}

export {};
