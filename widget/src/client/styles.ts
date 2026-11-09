import { el } from "./dom";

const SANS = 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

const CSS = [
  `.smiles{font:400 15px/1.5 ${SANS};color:#1a1a1a;text-align:center}`,
  ".smiles-q{margin:0 0 14px;font-size:16px;font-weight:500;color:#1a1a1a}",
  ".smiles-faces{display:flex;justify-content:center;gap:10px}",
  ".smiles-face{display:flex;flex-direction:column;align-items:center;gap:7px;padding:13px 16px;border:1px solid #e8e8e8;border-radius:10px;background:#fff;color:#c2c2c2;font:inherit;font-size:12.5px;line-height:1;cursor:pointer;transition:color .15s,border-color .15s,background .15s}",
  ".smiles-face:hover{background:#fafafa}",
  '.smiles-face[data-picked="true"],.smiles-face:hover{border-color:currentColor}',
  ".smiles-face span{color:#6b6b6b}",
  ".smiles-follow{margin-top:14px}",
  ".smiles-follow textarea{display:block;width:100%;max-width:400px;margin:0 auto;min-height:70px;padding:10px 12px;border:1px solid #dedede;border-radius:8px;color:#1a1a1a;font:inherit;font-size:14px;resize:vertical;box-sizing:border-box}",
  ".smiles-follow textarea:focus{outline:none;border-color:#1a1a1a}",
  ".smiles-follow button{margin-top:10px;padding:9px 20px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;font:inherit;font-weight:500;font-size:14px;cursor:pointer}",
  ".smiles-thanks{margin:0;color:#49b571;font-weight:500}",
  ".smiles-tab{position:fixed;right:20px;bottom:0;z-index:9999;width:304px;max-width:calc(100vw - 40px);border:1px solid #e8e8e8;border-bottom:0;border-radius:12px 12px 0 0;background:#fff;box-shadow:0 -4px 24px rgba(0,0,0,.09);transform:translateY(calc(100% - 42px));transition:transform .25s ease}",
  '.smiles-tab[data-open="true"]{transform:translateY(0)}',
  `.smiles-tab-handle{display:block;width:100%;height:42px;border:0;border-radius:11px 11px 0 0;background:#1a1a1a;color:#fff;font:500 14px/42px ${SANS};cursor:pointer}`,
  ".smiles-tab .smiles{padding:20px 18px 22px}",
].join("");

export function styles(): void {
  if (document.getElementById("smiles-styles")) return;
  document.head.appendChild(el("style", { id: "smiles-styles", type: "text/css", text: CSS }));
}
