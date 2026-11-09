import { db } from "./db";
import { env } from "./env";
import { ANSWERS, COLORS, FACES } from "./types";
import type {
  CustomWebhookConfig,
  Delivery,
  DestinationConfig,
  DestinationKind,
  DestinationRow,
  EmailConfig,
  Json,
  SiteRow,
  WebhookUrlConfig,
} from "./types";

interface Summary {
  label: string;
  title: string;
  question: string;
  note: string;
  page: string;
}

function summarise(answer: Delivery, site: SiteRow): Summary {
  const label = ANSWERS[answer.answer] ?? answer.answer;
  return {
    label,
    title: `${FACES[answer.answer]} ${label}, ${site.name}`,
    question: answer.question ?? site.question,
    note: answer.note ?? "",
    page: answer.page ?? "",
  };
}

// Resend is a public OAuth client: tokens last 15 minutes and every refresh
// rotates the refresh token, so the fresh pair goes back onto the row.
async function resendAccessToken(dest: DestinationRow, config: EmailConfig): Promise<string> {
  if (config.access_token && Number(config.expires_at ?? 0) > Date.now() + 60_000) {
    return config.access_token;
  }

  const clientId = env("RESEND_CLIENT_ID");
  if (!clientId) throw new Error("RESEND_CLIENT_ID is not set, so this connection cannot be refreshed");

  const res = await fetch("https://api.resend.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: config.refresh_token ?? "",
    }).toString(),
  });
  const payload: Json = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    throw new Error(`resend refresh failed: ${payload.error_description ?? payload.error ?? res.status}`);
  }

  const next: EmailConfig = {
    ...config,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? config.refresh_token,
    expires_at: Date.now() + (payload.expires_in ?? 900) * 1000,
  };
  await db.sql`UPDATE destinations SET config = ${JSON.stringify(next)} WHERE id = ${dest.id}`.run();
  return next.access_token as string;
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function check(res: Response, who: string): Promise<void> {
  if (!res.ok) throw new Error(`${who} ${res.status}: ${await res.text()}`);
}

async function sendEmail(dest: DestinationRow, config: EmailConfig, answer: Delivery, site: SiteRow): Promise<void> {
  const token = config.refresh_token
    ? await resendAccessToken(dest, config)
    : config.api_key || env("RESEND_API_KEY");
  if (!token) throw new Error("connect Resend, or set RESEND_API_KEY");

  const s = summarise(answer, site);
  const res = await post("https://api.resend.com/emails", {
    from: config.from || env("RESEND_FROM", "Smiles <onboarding@resend.dev>"),
    to: Array.isArray(config.to) ? config.to : [config.to],
    subject: s.title,
    text: [
      `${s.label}: ${s.question}`,
      s.note && `\n"${s.note}"`,
      s.page && `\nPage: ${s.page}`,
      `\nSite: ${site.name} (${site.key})`,
    ].filter(Boolean).join("\n"),
  }, { authorization: `Bearer ${token}` });

  await check(res, "resend");
}

async function sendSlack(_dest: DestinationRow, config: WebhookUrlConfig, answer: Delivery, site: SiteRow): Promise<void> {
  const s = summarise(answer, site);
  const lines = [`*${s.title}*`, `_${s.question}_`];
  if (s.note) lines.push(`> ${s.note}`);
  if (s.page) lines.push(`<${s.page}|${s.page}>`);

  const res = await post(config.webhook_url, {
    text: s.title,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  });
  await check(res, "slack");
}

async function sendDiscord(_dest: DestinationRow, config: WebhookUrlConfig, answer: Delivery, site: SiteRow): Promise<void> {
  const s = summarise(answer, site);
  const fields: Array<{ name: string; value: string }> = [];
  if (s.note) fields.push({ name: "They said", value: s.note.slice(0, 1024) });
  if (s.page) fields.push({ name: "Page", value: s.page.slice(0, 1024) });

  const res = await post(config.webhook_url, {
    embeds: [{
      title: s.title,
      description: s.question,
      color: parseInt(COLORS[answer.answer].slice(1), 16),
      fields,
    }],
  });
  await check(res, "discord");
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendWebhook(_dest: DestinationRow, config: CustomWebhookConfig, answer: Delivery, site: SiteRow): Promise<void> {
  const body = JSON.stringify({
    site: site.key,
    question: answer.question ?? site.question,
    answer: answer.answer,
    note: answer.note ?? null,
    page: answer.page ?? null,
    at: answer.created_at ?? new Date().toISOString(),
  });

  const headers: Record<string, string> = { "user-agent": "smiles-edge" };
  if (config.secret) headers["x-smiles-signature"] = `sha256=${await sign(config.secret, body)}`;

  await check(await post(config.url, body, headers), "webhook");
}

type Sender = (dest: DestinationRow, config: any, answer: Delivery, site: SiteRow) => Promise<void>;

const SENDERS: Record<DestinationKind, Sender> = {
  email: sendEmail,
  slack: sendSlack,
  discord: sendDiscord,
  webhook: sendWebhook,
};

export const isDestinationKind = (value: string): value is DestinationKind => value in SENDERS;

export async function deliver(dest: DestinationRow, answer: Delivery, site: SiteRow): Promise<void> {
  await SENDERS[dest.kind](dest, JSON.parse(dest.config) as DestinationConfig, answer, site);
}

/** Fan out to every destination that wants this answer. Never throws. */
export async function fanOut(site: SiteRow, answer: Delivery): Promise<void> {
  const destinations = await db
    .sql<DestinationRow>`SELECT * FROM destinations WHERE site_key = ${site.key}`
    .all();
  const wanted = destinations.filter((d) => !d.only_bad || answer.answer === "bad");
  await Promise.allSettled(wanted.map((d) => deliver(d, answer, site)));
}
