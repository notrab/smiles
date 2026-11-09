import type { AnswerOption } from "./types";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  kids: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  kids.forEach((kid) => node.appendChild(kid));
  return node;
}

const NS = "http://www.w3.org/2000/svg";

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export function face(answer: AnswerOption): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "0 0 48 48", width: "48", height: "48", "aria-hidden": "true" });
  const stroke = { fill: "none", stroke: "currentColor", "stroke-width": "2.5" };

  svg.appendChild(svgEl("circle", { cx: "24", cy: "24", r: "21", ...stroke }));
  for (const cx of ["16", "32"]) {
    svg.appendChild(svgEl("circle", { cx, cy: "18", r: "2.6", fill: "currentColor" }));
  }
  svg.appendChild(svgEl("path", { d: answer.mouth, "stroke-linecap": "round", ...stroke }));

  return svg;
}
