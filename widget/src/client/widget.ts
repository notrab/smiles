import { el, face } from "./dom";
import { styles } from "./styles";
import { ANSWERS, config } from "./types";
import type { AnswerOption, Payload, WidgetOptions } from "./types";

const listeners: Array<(payload: Payload) => void> = [];

export const onVote = (fn: (payload: Payload) => void): void => {
  listeners.push(fn);
};

/** Fire and forget: a host page never breaks because feedback failed to send. */
function send(payload: Payload, beacon: boolean): void {
  const url = `${config.api}/v1/answer`;

  if (beacon && navigator.sendBeacon) {
    // text/plain keeps the beacon a simple request: a beacon cannot answer a
    // CORS preflight, and the API parses the body either way.
    navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" }));
    return;
  }

  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function mount(root: HTMLElement, options: WidgetOptions = {}): HTMLElement {
  const question = options.question || root.getAttribute("data-question") || config.question;

  styles();
  root.classList.add("smiles");
  root.innerHTML = "";

  const faces = el("div", { class: "smiles-faces" });
  const follow = el("div", { class: "smiles-follow" });
  follow.hidden = true;

  const comment = el("textarea", { placeholder: "Anything you'd like to add? (optional)" });
  const sendButton = el("button", { type: "button", text: "Send" });
  follow.appendChild(comment);
  follow.appendChild(el("div", {}, [sendButton]));

  let picked: AnswerOption | null = null;
  let sent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onHidden = () => {
    if (document.visibilityState === "hidden") onLeave();
  };
  const onLeave = () => deliver(comment.value.trim(), true);

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

    send(payload, beacon);
    listeners.forEach((fn) => fn(payload));
  }

  function vote(answer: AnswerOption, button: HTMLButtonElement): void {
    picked = answer;
    for (const node of Array.from(faces.children) as HTMLElement[]) {
      node.setAttribute("data-picked", node === button ? "true" : "false");
      node.style.opacity = node === button ? "1" : ".45";
    }
    follow.hidden = false;
    comment.focus();

    // Sent once: on Send, when the page goes away, or after a minute. Someone
    // who picks a face and wanders off still counts, and nobody counts twice.
    timer = setTimeout(() => deliver(comment.value.trim()), 60000);
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHidden);
  }

  for (const answer of ANSWERS) {
    const button = el("button", { class: "smiles-face", type: "button", "aria-label": answer.label });
    button.style.color = answer.color;
    button.appendChild(face(answer));
    button.appendChild(el("span", { text: answer.label }));
    button.addEventListener("click", () => vote(answer, button));
    faces.appendChild(button);
  }

  sendButton.addEventListener("click", () => {
    deliver(comment.value.trim());
    root.innerHTML = "";
    root.appendChild(el("p", { class: "smiles-thanks", text: "Thanks, noted!" }));
  });

  root.appendChild(el("p", { class: "smiles-q", text: question }));
  root.appendChild(faces);
  root.appendChild(follow);

  return root;
}

export function tab(options: WidgetOptions = {}): HTMLElement {
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
}
