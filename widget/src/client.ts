/*
 * The Smiles widget, as it runs in a visitor's browser.
 *
 * The build bundles this into one minified IIFE (scripts/build.mjs) and the
 * widget Edge Script serves it with a per-site config in front of it. It has
 * no dependencies and never throws into the host page.
 */

type AnswerKey = "great" | "ok" | "bad";

interface AnswerOption {
  key: AnswerKey;
  label: string;
  color: string;
  mouth: string;
}

interface WidgetConfig {
  site: string;
  api: string;
  question: string;
  label: string;
  /** false, true (use the site question), or a question of its own. */
  tab: boolean | string;
}

interface Payload {
  site: string;
  question: string;
  answer: AnswerKey;
  note: string | null;
  page: string;
}

interface WidgetOptions {
  question?: string;
  label?: string;
}

interface Stats {
  great: number;
  ok: number;
  bad: number;
  total: number;
  score: number | null;
}

declare global {
  interface Window {
    __SMILES_CONFIG__?: WidgetConfig;
    Smiles?: typeof Smiles;
  }
}

const config: WidgetConfig = window.__SMILES_CONFIG__ ?? {
  site: "",
  api: "",
  question: "How are we doing?",
  label: "Feedback",
  tab: false,
};

const ANSWERS: AnswerOption[] = [
  { key: "great", label: "Awesome", color: "#49b571", mouth: "M14,25 Q24,35 34,25" },
  { key: "ok", label: "Just OK", color: "#e3a53c", mouth: "M14,28 L34,28" },
  { key: "bad", label: "Not good", color: "#eb575c", mouth: "M14,31 Q24,22 34,31" },
];

const listeners: Array<(payload: Payload) => void> = [];

function el<K extends keyof HTMLElementTagNameMap>(
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

function face(answer: AnswerOption): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "48");
  svg.setAttribute("height", "48");
  svg.setAttribute("aria-hidden", "true");

  const ring = document.createElementNS(ns, "circle");
  ring.setAttribute("cx", "24");
  ring.setAttribute("cy", "24");
  ring.setAttribute("r", "21");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "currentColor");
  ring.setAttribute("stroke-width", "2.5");
  svg.appendChild(ring);

  for (const x of [16, 32]) {
    const eye = document.createElementNS(ns, "circle");
    eye.setAttribute("cx", String(x));
    eye.setAttribute("cy", "18");
    eye.setAttribute("r", "2.6");
    eye.setAttribute("fill", "currentColor");
    svg.appendChild(eye);
  }

  const mouth = document.createElementNS(ns, "path");
  mouth.setAttribute("d", answer.mouth);
  mouth.setAttribute("fill", "none");
  mouth.setAttribute("stroke", "currentColor");
  mouth.setAttribute("stroke-width", "2.5");
  mouth.setAttribute("stroke-linecap", "round");
  svg.appendChild(mouth);

  return svg;
}

const SANS = 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

function styles(): void {
  if (document.getElementById("smiles-styles")) return;
  const css = [
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
  document.head.appendChild(el("style", { id: "smiles-styles", type: "text/css", text: css }));
}

/** Fire and forget: a host page never breaks because feedback failed to send. */
function post(path: string, body: Payload): void {
  fetch(config.api + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

function mount(root: HTMLElement, options: WidgetOptions = {}): HTMLElement {
  const question = options.question || root.getAttribute("data-question") || config.question;

  styles();
  root.classList.add("smiles");
  root.innerHTML = "";

  const faces = el("div", { class: "smiles-faces" });
  const follow = el("div", { class: "smiles-follow" });
  follow.hidden = true;

  for (const answer of ANSWERS) {
    const button = el("button", { class: "smiles-face", type: "button", "aria-label": answer.label });
    button.style.color = answer.color;
    button.appendChild(face(answer));
    button.appendChild(el("span", { text: answer.label }));
    button.addEventListener("click", () => vote(answer, button));
    faces.appendChild(button);
  }

  const comment = el("textarea", { placeholder: "Anything you'd like to add? (optional)" });
  const send = el("button", { type: "button", text: "Send" });
  follow.appendChild(comment);
  follow.appendChild(el("div", {}, [send]));

  root.appendChild(el("p", { class: "smiles-q", text: question }));
  root.appendChild(faces);
  root.appendChild(follow);

  let picked: AnswerOption | null = null;
  let sent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function vote(answer: AnswerOption, button: HTMLButtonElement): void {
    picked = answer;
    for (const node of Array.from(faces.children) as HTMLElement[]) {
      node.setAttribute("data-picked", node === button ? "true" : "false");
      node.style.opacity = node === button ? "1" : ".45";
    }
    follow.hidden = false;
    comment.focus();
    // The answer is sent once and once only: on Send, when the page goes away,
    // or after a minute. Someone who picks a face and wanders off still counts,
    // and nobody ever counts twice.
    timer = setTimeout(() => deliver(comment.value.trim()), 60000);
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHidden);
  }

  function onHidden(): void {
    if (document.visibilityState === "hidden") onLeave();
  }

  function onLeave(): void {
    deliver(comment.value.trim(), true);
  }

  function deliver(note: string, beacon = false): void {
    if (sent || !picked) return;
    sent = true;
    clearTimeout(timer);
    window.removeEventListener("pagehide", onLeave);
    document.removeEventListener("visibilitychange", onHidden);

    const payload: Payload = {
      site: config.site,
      question,
      answer: picked.key,
      note: note || null,
      page: location.href,
    };

    if (beacon && navigator.sendBeacon) {
      // text/plain keeps the beacon a simple request: a beacon cannot answer a
      // CORS preflight, and the API parses the body either way.
      navigator.sendBeacon(
        config.api + "/v1/answer",
        new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" }),
      );
    } else {
      post("/v1/answer", payload);
    }

    listeners.forEach((fn) => fn(payload));
  }

  send.addEventListener("click", () => {
    deliver(comment.value.trim());
    root.innerHTML = "";
    root.appendChild(el("p", { class: "smiles-thanks", text: "Thanks, noted!" }));
  });

  return root;
}

const Smiles = {
  site: config.site,
  api: config.api,

  /** Called with every answer this page records. */
  onVote(fn: (payload: Payload) => void): void {
    listeners.push(fn);
  },

  stats(): Promise<Stats> {
    return fetch(`${config.api}/v1/stats/${config.site}`).then((res) => res.json() as Promise<Stats>);
  },

  inline(root: HTMLElement, options: WidgetOptions = {}): HTMLElement {
    return mount(root, options);
  },

  tab(options: WidgetOptions = {}): HTMLElement {
    styles();
    const host = el("div", { class: "smiles-tab", "data-open": "false" });
    const handle = el("button", {
      class: "smiles-tab-handle",
      type: "button",
      text: options.label || config.label,
    });
    const body = el("div", {});
    host.appendChild(handle);
    host.appendChild(body);
    document.body.appendChild(host);
    mount(body, options);
    handle.addEventListener("click", () => {
      host.setAttribute("data-open", host.getAttribute("data-open") === "true" ? "false" : "true");
    });
    return host;
  },

  boot(): void {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-smiles]"))) {
      if (node.getAttribute("data-smiles-ready")) continue;
      node.setAttribute("data-smiles-ready", "1");
      mount(node);
    }
    if (config.tab) {
      Smiles.tab({ question: config.tab === true ? config.question : config.tab });
    }
  },
};

window.Smiles = Smiles;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", Smiles.boot);
} else {
  Smiles.boot();
}

export {};
