/*
 * Smiles API, a Bunny Edge Script.
 *
 * Public:
 *   GET  /v1/config                     what the dashboard may offer
 *   POST /v1/signup                     { name, email, question }
 *   POST /v1/answer                     record an answer, fan it out to destinations
 *   GET  /v1/stats/:site                counts + satisfaction score
 *
 * Owner (Authorization: Bearer <admin_token>):
 *   GET    /v1/sites/:site              site + destinations
 *   PATCH  /v1/sites/:site              { question, name }
 *   GET    /v1/sites/:site/answers      recent answers
 *   POST   /v1/sites/:site/destinations { kind, label, config, only_bad }
 *   POST   /v1/sites/:site/destinations/:id/test
 *   DELETE /v1/sites/:site/destinations/:id
 *
 * Back office (X-Signup-Token: <SMILES_SIGNUP_TOKEN>):
 *   POST /v1/sites                      { key, name, question }
 *
 * Connect a destination:
 *   GET /v1/connect/:kind/start?site=&token=
 *   GET /v1/connect/:kind/callback?code=&state=
 *
 * Env: BUNNY_DATABASE_URL, BUNNY_DATABASE_AUTH_TOKEN, SMILES_SIGNUP_TOKEN,
 *      SMILES_DASHBOARD_URL, RESEND_CLIENT_ID, RESEND_API_KEY, RESEND_FROM,
 *      SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
 */
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import { connect } from "@bunny.net/database-client";

const env = (name: string, fallback = ""): string => Deno.env.get(name) ?? fallback;

/* ------------------------------------------------------------------ *
 * What we store
 * ------------------------------------------------------------------ */

type AnswerKey = "great" | "ok" | "bad";
type DestinationKind = "email" | "slack" | "discord" | "webhook";
type ProviderKind = "slack" | "discord" | "resend";

interface SiteRow {
  key: string;
  name: string;
  question: string;
  admin_token: string;
  email: string | null;
  created_ip: string | null;
  created_at: string;
}

interface DestinationRow {
  id: number;
  site_key: string;
  kind: DestinationKind;
  label: string | null;
  config: string;
  only_bad: number;
  created_at: string;
}

interface OAuthStateRow {
  state: string;
  site_key: string;
  kind: string;
  verifier: string | null;
  extra: string | null;
}

interface EmailConfig {
  to: string | string[];
  from?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

interface WebhookUrlConfig {
  webhook_url: string;
}

interface CustomWebhookConfig {
  url: string;
  secret?: string;
}

type DestinationConfig = EmailConfig | WebhookUrlConfig | CustomWebhookConfig;

/** One answer, on its way to a destination. */
interface Delivery {
  answer: AnswerKey;
  note?: string | null;
  page?: string | null;
  question?: string;
  created_at?: string;
}

/** Whatever a third party sent back. Theirs to shape, ours to check. */
type Json = Record<string, any>;

const ANSWERS: Record<AnswerKey, string> = { great: "Awesome", ok: "Just OK", bad: "Not good" };
const COLORS: Record<AnswerKey, string> = { great: "#49b571", ok: "#fec861", bad: "#eb575c" };
const FACES: Record<AnswerKey, string> = { great: "🙂", ok: "😐", bad: "🙁" };

const isAnswerKey = (value: string): value is AnswerKey => value in ANSWERS;

/* ------------------------------------------------------------------ *
 * Bunny Database
 *
 * `connect()` can find the credentials itself, but only through `process.env`,
 * and Edge Scripting is Deno, so they are passed in explicitly. Every query
 * below is a tagged template: interpolated values are bound, never
 * concatenated into the SQL.
 * ------------------------------------------------------------------ */

const db = connect({
  url: env("BUNNY_DATABASE_URL"),
  authToken: env("BUNNY_DATABASE_AUTH_TOKEN"),
});

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-signup-token",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "86400",
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

const fail = (status: number, message: string): Response => json({ error: message }, status);

function randomKey(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** A key from whatever the visitor typed: "Acme Inc." -> "acme-inc". */
function slugify(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function freeKey(preferred: string): Promise<string> {
  const base = slugify(preferred) || randomKey(8);
  if (base.length < 3) return randomKey(8);
  for (const candidate of [base, `${base}-${randomKey(3)}`, `${base}-${randomKey(5)}`]) {
    const taken = await db.sql`SELECT key FROM sites WHERE key = ${candidate}`.first();
    if (!taken) return candidate;
  }
  return randomKey(10);
}

const looksLikeEmail = (value: unknown): boolean => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(value ?? ""));

const clientIp = (req: Request): string => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

/** Create a site. Shared by public sign-up and the token-gated route. */
async function createSite(input: {
  key: string;
  name: string;
  question: string;
  email?: string | null;
  ip?: string | null;
}): Promise<{ key: string; admin_token: string }> {
  const adminToken = randomKey(40);
  await db.sql`
    INSERT INTO sites (key, name, question, admin_token, email, created_ip)
    VALUES (${input.key}, ${input.name}, ${input.question}, ${adminToken}, ${input.email ?? null}, ${input.ip || null})
  `.run();
  return { key: input.key, admin_token: adminToken };
}

async function readJson(req: Request): Promise<Json> {
  try {
    return (await req.json()) as Json;
  } catch {
    return {};
  }
}

/** Resolve the site and check the bearer token matches its admin token. */
async function authorize(
  req: Request,
  siteKey: string,
): Promise<{ site: SiteRow; error?: undefined } | { site?: undefined; error: Response }> {
  const site = await db.sql<SiteRow>`SELECT * FROM sites WHERE key = ${siteKey}`.first();
  if (!site) return { error: fail(404, "no such site") };
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== site.admin_token) return { error: fail(401, "bad admin token") };
  return { site };
}

/* ------------------------------------------------------------------ *
 * Destinations: where answers go
 * ------------------------------------------------------------------ */

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

/**
 * A Resend connection is a public OAuth client: the access token lasts 15
 * minutes and every refresh rotates the refresh token, so a fresh pair is
 * written straight back onto the destination row.
 */
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

async function sendEmail(dest: DestinationRow, config: EmailConfig, answer: Delivery, site: SiteRow): Promise<void> {
  // Either an OAuth connection (preferred) or a plain API key.
  const token = config.refresh_token
    ? await resendAccessToken(dest, config)
    : config.api_key || env("RESEND_API_KEY");
  if (!token) throw new Error("connect Resend, or set RESEND_API_KEY");

  const s = summarise(answer, site);
  const body = {
    from: config.from || env("RESEND_FROM", "Smiles <onboarding@resend.dev>"),
    to: Array.isArray(config.to) ? config.to : [config.to],
    subject: s.title,
    text: [
      `${s.label}: ${s.question}`,
      s.note && `\n"${s.note}"`,
      s.page && `\nPage: ${s.page}`,
      `\nSite: ${site.name} (${site.key})`,
    ].filter(Boolean).join("\n"),
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

async function sendSlack(_dest: DestinationRow, config: WebhookUrlConfig, answer: Delivery, site: SiteRow): Promise<void> {
  const s = summarise(answer, site);
  const lines = [`*${s.title}*`, `_${s.question}_`];
  if (s.note) lines.push(`> ${s.note}`);
  if (s.page) lines.push(`<${s.page}|${s.page}>`);
  const res = await fetch(config.webhook_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: s.title,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
    }),
  });
  if (!res.ok) throw new Error(`slack ${res.status}: ${await res.text()}`);
}

async function sendDiscord(_dest: DestinationRow, config: WebhookUrlConfig, answer: Delivery, site: SiteRow): Promise<void> {
  const s = summarise(answer, site);
  const fields: Array<{ name: string; value: string }> = [];
  if (s.note) fields.push({ name: "They said", value: s.note.slice(0, 1024) });
  if (s.page) fields.push({ name: "Page", value: s.page.slice(0, 1024) });
  const res = await fetch(config.webhook_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: s.title,
        description: s.question,
        color: parseInt(COLORS[answer.answer].slice(1), 16),
        fields,
      }],
    }),
  });
  if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
}

async function signPayload(secret: string, body: string): Promise<string> {
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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "smiles-edge",
  };
  if (config.secret) headers["x-smiles-signature"] = `sha256=${await signPayload(config.secret, body)}`;
  const res = await fetch(config.url, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
}

type Sender = (dest: DestinationRow, config: any, answer: Delivery, site: SiteRow) => Promise<void>;

const SENDERS: Record<DestinationKind, Sender> = {
  email: sendEmail,
  slack: sendSlack,
  discord: sendDiscord,
  webhook: sendWebhook,
};

const isDestinationKind = (value: string): value is DestinationKind => value in SENDERS;

async function deliver(dest: DestinationRow, answer: Delivery, site: SiteRow): Promise<void> {
  const config = JSON.parse(dest.config) as DestinationConfig;
  await SENDERS[dest.kind](dest, config, answer, site);
}

/** Fan out to every destination that wants this answer. Never throws. */
async function fanOut(site: SiteRow, answer: Delivery): Promise<void> {
  const destinations = await db
    .sql<DestinationRow>`SELECT * FROM destinations WHERE site_key = ${site.key}`
    .all();
  const wanted = destinations.filter((d) => !d.only_bad || answer.answer === "bad");
  const results = await Promise.allSettled(wanted.map((d) => deliver(d, answer, site)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.log(`[smiles] ${wanted[i].kind} destination ${wanted[i].id} failed: ${result.reason}`);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Connecting a destination
 *
 * Three providers, one flow. Slack and Discord are confidential clients with
 * a secret; Resend is a public client using PKCE, registered dynamically at
 * setup time so nobody has to click through a dashboard to create an app.
 * ------------------------------------------------------------------ */

interface Connection {
  kind: DestinationKind;
  label: string;
  config: DestinationConfig;
}

interface Provider {
  authorize: string;
  token: string;
  scope: string;
  responseType?: boolean;
  pkce?: boolean;
  clientId: () => string;
  clientSecret: () => string;
  destination: (payload: Json, extra: Json) => Connection;
}

const OAUTH: Record<ProviderKind, Provider> = {
  slack: {
    authorize: "https://slack.com/oauth/v2/authorize",
    token: "https://slack.com/api/oauth.v2.access",
    scope: "incoming-webhook",
    clientId: () => env("SLACK_CLIENT_ID"),
    clientSecret: () => env("SLACK_CLIENT_SECRET"),
    destination: (payload) => {
      if (!payload.ok) throw new Error(payload.error ?? "slack rejected the exchange");
      return {
        kind: "slack",
        label: `${payload.team?.name ?? "Slack"} · ${payload.incoming_webhook?.channel ?? ""}`.trim(),
        config: { webhook_url: payload.incoming_webhook?.url },
      };
    },
  },

  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    scope: "webhook.incoming",
    responseType: true,
    clientId: () => env("DISCORD_CLIENT_ID"),
    clientSecret: () => env("DISCORD_CLIENT_SECRET"),
    destination: (payload) => {
      if (!payload.webhook?.url) throw new Error(payload.error_description ?? "discord returned no webhook");
      return {
        kind: "discord",
        label: `${payload.guild?.name ?? "Discord"} · #${payload.webhook.name ?? ""}`.trim(),
        config: { webhook_url: payload.webhook.url },
      };
    },
  },

  resend: {
    authorize: "https://api.resend.com/oauth/authorize",
    token: "https://api.resend.com/oauth/token",
    scope: "emails:send",
    responseType: true,
    pkce: true,
    clientId: () => env("RESEND_CLIENT_ID"),
    clientSecret: () => "",
    destination: (payload, extra) => {
      if (!payload.access_token) {
        throw new Error(payload.error_description ?? payload.error ?? "resend returned no token");
      }
      if (!extra.to) throw new Error("no address to notify");
      return {
        kind: "email",
        label: `Resend · ${extra.to}`,
        config: {
          to: extra.to,
          from: extra.from || undefined,
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
          expires_at: Date.now() + (payload.expires_in ?? 900) * 1000,
        },
      };
    },
  },
};

const isProviderKind = (value: string): value is ProviderKind => value in OAUTH;

const base64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

const callbackUrl = (req: Request, kind: string): string =>
  new URL(`/v1/connect/${kind}/callback`, new URL(req.url).origin).toString();

async function connectStart(req: Request, kind: ProviderKind): Promise<Response> {
  const provider = OAUTH[kind];
  if (!provider.clientId()) return fail(501, `${kind} is not configured on this deployment`);

  const url = new URL(req.url);
  const siteKey = url.searchParams.get("site") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const site = await db.sql<SiteRow>`SELECT * FROM sites WHERE key = ${siteKey}`.first();
  if (!site || site.admin_token !== token) return fail(401, "bad site or admin token");

  // Anything the callback will need but OAuth won't carry for us.
  const extra = { to: url.searchParams.get("to") ?? "", from: url.searchParams.get("from") ?? "" };
  const state = randomKey(32);
  const pkce = provider.pkce ? await pkcePair() : { verifier: null, challenge: null };

  await db.sql`
    INSERT INTO oauth_states (state, site_key, kind, verifier, extra)
    VALUES (${state}, ${siteKey}, ${kind}, ${pkce.verifier}, ${JSON.stringify(extra)})
  `.run();

  const authorize = new URL(provider.authorize);
  authorize.searchParams.set("client_id", provider.clientId());
  authorize.searchParams.set("scope", provider.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("redirect_uri", callbackUrl(req, kind));
  if (provider.responseType) authorize.searchParams.set("response_type", "code");
  if (provider.pkce && pkce.challenge) {
    authorize.searchParams.set("code_challenge", pkce.challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
  }

  return Response.redirect(authorize.toString(), 302);
}

async function connectCallback(req: Request, kind: ProviderKind): Promise<Response> {
  const provider = OAUTH[kind];
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(400, "missing code or state");

  const pending = await db
    .sql<OAuthStateRow>`SELECT * FROM oauth_states WHERE state = ${state} AND kind = ${kind}`
    .first();
  if (!pending) return fail(400, "unknown or expired state");
  await db.sql`DELETE FROM oauth_states WHERE state = ${state}`.run();

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: provider.clientId(),
    code,
    redirect_uri: callbackUrl(req, kind),
  });
  if (provider.clientSecret()) form.set("client_secret", provider.clientSecret());
  if (pending.verifier) form.set("code_verifier", pending.verifier);

  const res = await fetch(provider.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const payload: Json = await res.json().catch(() => ({}));

  let connection: Connection;
  try {
    connection = provider.destination(payload, JSON.parse(pending.extra ?? "{}"));
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : String(err));
  }

  await db.sql`
    INSERT INTO destinations (site_key, kind, label, config, only_bad)
    VALUES (${pending.site_key}, ${connection.kind}, ${connection.label}, ${JSON.stringify(connection.config)}, 0)
  `.run();

  const dashboard = env("SMILES_DASHBOARD_URL");
  return dashboard
    ? Response.redirect(`${dashboard}#connected=${kind}`, 302)
    : json({ ok: true, connected: kind, site: pending.site_key });
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean); // ["v1", "sites", "acme", ...]
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/" || path === "/v1") {
    return json({ service: "smiles", ok: true });
  }

  // What the dashboard should offer: a Connect button needs credentials behind it.
  if (method === "GET" && path === "/v1/config") {
    return json({
      connect: {
        slack: !!env("SLACK_CLIENT_ID"),
        discord: !!env("DISCORD_CLIENT_ID"),
        resend: !!env("RESEND_CLIENT_ID"),
      },
      resend_api_key: !!env("RESEND_API_KEY"),
    });
  }

  // POST /v1/answer
  if (method === "POST" && path === "/v1/answer") {
    const body = await readJson(req);
    const siteKey = String(body.site ?? "");
    const answer = String(body.answer ?? "");
    if (!isAnswerKey(answer)) return fail(400, "answer must be great, ok or bad");

    const site = await db.sql<SiteRow>`SELECT * FROM sites WHERE key = ${siteKey}`.first();
    if (!site) return fail(404, "no such site");

    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const page = body.page ? String(body.page).slice(0, 500) : null;

    const recorded = await db.sql<{ id: number; created_at: string }>`
      INSERT INTO answers (site_key, answer, note, page)
      VALUES (${siteKey}, ${answer}, ${note}, ${page})
      RETURNING id, created_at
    `.first();

    await fanOut(site, {
      answer,
      note,
      page,
      question: body.question,
      created_at: recorded?.created_at,
    });
    return json({ ok: true, id: recorded?.id });
  }

  // GET /v1/stats/:site
  if (method === "GET" && parts[0] === "v1" && parts[1] === "stats" && parts[2]) {
    const rows = await db.sql<{ answer: AnswerKey; total: number }>`
      SELECT answer, COUNT(*) AS total FROM answers WHERE site_key = ${parts[2]} GROUP BY answer
    `.all();
    const counts: Record<AnswerKey, number> = { great: 0, ok: 0, bad: 0 };
    rows.forEach((row) => { counts[row.answer] = row.total; });
    const total = counts.great + counts.ok + counts.bad;
    return json({ ...counts, total, score: total ? Math.round((counts.great / total) * 100) : null });
  }

  // POST /v1/signup: public, this is what the sign-up page posts to
  if (method === "POST" && path === "/v1/signup") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!looksLikeEmail(email)) return fail(400, "that doesn't look like an email address");
    if (name.length < 2) return fail(400, "what should we call your site?");

    // Fail open when there's no client IP to key on: better a missing rate
    // limit than a signup form nobody can use.
    const ip = clientIp(req);
    if (ip) {
      const recent = await db.sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM sites
        WHERE created_ip = ${ip} AND created_at > datetime('now', '-1 hour')
      `.first();
      if ((recent?.n ?? 0) >= 3) return fail(429, "that's a few sites in one hour, try again later");
    }

    const key = await freeKey(String(body.key || name));
    const created = await createSite({
      key,
      name,
      question: String(body.question || "How are we doing?").slice(0, 200),
      email,
      ip,
    });
    return json(created, 201);
  }

  // POST /v1/sites  (token-gated, for scripts and back-office use)
  if (method === "POST" && path === "/v1/sites") {
    const expected = env("SMILES_SIGNUP_TOKEN");
    if (!expected || req.headers.get("x-signup-token") !== expected) return fail(401, "bad signup token");

    const body = await readJson(req);
    const key = String(body.key ?? randomKey(10)).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (key.length < 3) return fail(400, "key must be at least 3 characters");
    if (await db.sql`SELECT key FROM sites WHERE key = ${key}`.first()) {
      return fail(409, "that key is taken");
    }

    const created = await createSite({
      key,
      name: String(body.name ?? key),
      question: String(body.question ?? "How are we doing?"),
      email: body.email,
      ip: clientIp(req),
    });
    return json(created, 201);
  }

  // Everything below is /v1/sites/:site/... and needs the admin token.
  if (parts[0] === "v1" && parts[1] === "sites" && parts[2]) {
    const siteKey = parts[2];
    const { site, error } = await authorize(req, siteKey);
    if (error) return error;

    const rest = parts.slice(3);

    if (rest.length === 0 && method === "GET") {
      const destinations = await db.sql<DestinationRow>`
        SELECT id, kind, label, config, only_bad, created_at
        FROM destinations WHERE site_key = ${siteKey} ORDER BY id
      `.all();
      return json({
        site: { key: site.key, name: site.name, question: site.question, created_at: site.created_at },
        destinations: destinations.map((d) => ({
          ...d,
          config: JSON.parse(d.config),
          only_bad: !!d.only_bad,
        })),
      });
    }

    if (rest.length === 0 && method === "PATCH") {
      const body = await readJson(req);
      await db.sql`
        UPDATE sites
        SET name = COALESCE(${body.name ?? null}, name), question = COALESCE(${body.question ?? null}, question)
        WHERE key = ${siteKey}
      `.run();
      return json({ ok: true });
    }

    if (rest[0] === "answers" && method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
      const answers = await db.sql`
        SELECT id, answer, note, page, created_at
        FROM answers WHERE site_key = ${siteKey} ORDER BY id DESC LIMIT ${limit}
      `.all();
      return json({ answers });
    }

    if (rest[0] === "destinations" && rest.length === 1 && method === "POST") {
      const body = await readJson(req);
      const kind = String(body.kind ?? "");
      if (!isDestinationKind(kind)) return fail(400, "kind must be email, slack, discord or webhook");

      const config: Json = body.config ?? {};
      if (kind === "email" && !config.to) return fail(400, "email destinations need a `to` address");
      if ((kind === "slack" || kind === "discord") && !config.webhook_url) return fail(400, "need a webhook_url");
      if (kind === "webhook" && !config.url) return fail(400, "webhook destinations need a `url`");

      const added = await db.sql<{ id: number }>`
        INSERT INTO destinations (site_key, kind, label, config, only_bad)
        VALUES (${siteKey}, ${kind}, ${body.label ?? null}, ${JSON.stringify(config)}, ${body.only_bad ? 1 : 0})
        RETURNING id
      `.first();
      return json({ ok: true, id: added?.id }, 201);
    }

    if (rest[0] === "destinations" && rest[1] && rest[2] === "test" && method === "POST") {
      const dest = await db
        .sql<DestinationRow>`SELECT * FROM destinations WHERE id = ${rest[1]} AND site_key = ${siteKey}`
        .first();
      if (!dest) return fail(404, "no such destination");
      try {
        await deliver(dest, {
          answer: "great",
          note: "This is a test from your Smiles dashboard.",
          page: env("SMILES_DASHBOARD_URL"),
          created_at: new Date().toISOString(),
        }, site);
        return json({ ok: true });
      } catch (err) {
        return fail(502, err instanceof Error ? err.message : String(err));
      }
    }

    if (rest[0] === "destinations" && rest[1] && rest.length === 2 && method === "DELETE") {
      await db.sql`DELETE FROM destinations WHERE id = ${rest[1]} AND site_key = ${siteKey}`.run();
      return json({ ok: true });
    }
  }

  // /v1/connect/:kind/start|callback
  if (parts[0] === "v1" && parts[1] === "connect" && parts[2] && isProviderKind(parts[2])) {
    if (parts[3] === "start" && method === "GET") return connectStart(req, parts[2]);
    if (parts[3] === "callback" && method === "GET") return connectCallback(req, parts[2]);
  }

  return fail(404, "not found");
}

BunnySDK.net.http.serve(async (req: Request): Promise<Response> => {
  try {
    return await route(req);
  } catch (err) {
    console.log(`[smiles] ${err instanceof Error ? err.stack : String(err)}`);
    return fail(500, "something broke on our end");
  }
});
