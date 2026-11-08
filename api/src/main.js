/*
 * Smiles API, a Bunny Edge Script.
 *
 * Public:
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
 * Sign-up (X-Signup-Token: <SMILES_SIGNUP_TOKEN>):
 *   POST /v1/sites                      { key, name, question }
 *
 * Slack / Discord install:
 *   GET /v1/connect/:kind/start?site=&token=
 *   GET /v1/connect/:kind/callback?code=&state=
 *
 * Env: BUNNY_DATABASE_URL, BUNNY_DATABASE_AUTH_TOKEN, SMILES_SIGNUP_TOKEN,
 *      SMILES_DASHBOARD_URL, RESEND_API_KEY, RESEND_FROM,
 *      SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
 */
import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.12.0";

const env = (name, fallback = "") => Deno.env.get(name) ?? fallback;

const ANSWERS = { great: "Awesome", ok: "Just OK", bad: "Not Good" };
const COLORS = { great: "#49b571", ok: "#fec861", bad: "#eb575c" };

/* ------------------------------------------------------------------ *
 * Bunny Database over its libsql HTTP endpoint, with no client library.
 * ------------------------------------------------------------------ */

function dbEndpoint() {
  const raw = env("BUNNY_DATABASE_URL");
  if (!raw) throw new Error("BUNNY_DATABASE_URL is not set");
  return raw.replace(/^libsql:/, "https:").replace(/\/+$/, "") + "/v2/pipeline";
}

function toArg(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  }
  return { type: "text", value: String(value) };
}

function fromValue(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer") return Number(cell.value);
  if (cell.type === "float") return cell.value;
  return cell.value;
}

/** Run one or more statements; returns an array of row-object arrays. */
async function sql(statements) {
  const requests = statements.map(([text, args = []]) => ({
    type: "execute",
    stmt: { sql: text, args: args.map(toArg) },
  }));
  requests.push({ type: "close" });

  const res = await fetch(dbEndpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env("BUNNY_DATABASE_AUTH_TOKEN")}`,
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) throw new Error(`database ${res.status}: ${await res.text()}`);

  const body = await res.json();
  return body.results.slice(0, statements.length).map((entry) => {
    if (entry.type === "error") throw new Error(entry.error?.message ?? "query failed");
    const result = entry.response.result;
    const columns = result.cols.map((c) => c.name);
    return result.rows.map((row) => {
      const out = {};
      columns.forEach((name, i) => { out[name] = fromValue(row[i]); });
      return out;
    });
  });
}

const queryOne = async (text, args) => (await sql([[text, args]]))[0][0] ?? null;
const queryAll = async (text, args) => (await sql([[text, args]]))[0];
const execute = (text, args) => sql([[text, args]]);

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-signup-token",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

const fail = (status, message) => json({ error: message }, status);

function randomKey(length = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** A key from whatever the visitor typed: "Acme Inc." -> "acme-inc". */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function freeKey(preferred) {
  const base = slugify(preferred) || randomKey(8);
  if (base.length < 3) return randomKey(8);
  for (const candidate of [base, `${base}-${randomKey(3)}`, `${base}-${randomKey(5)}`]) {
    if (!(await queryOne("SELECT key FROM sites WHERE key = ?", [candidate]))) return candidate;
  }
  return randomKey(10);
}

const looksLikeEmail = (value) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(value ?? ""));

const clientIp = (req) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

/** Create a site. Shared by public sign-up and the token-gated admin route. */
async function createSite({ key, name, question, email, ip }) {
  const adminToken = randomKey(40);
  await execute(
    "INSERT INTO sites (key, name, question, admin_token, email, created_ip) VALUES (?, ?, ?, ?, ?, ?)",
    [key, name, question, adminToken, email ?? null, ip || null],
  );
  return { key, admin_token: adminToken };
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** Resolve the site and check the bearer token matches its admin token. */
async function authorize(req, siteKey) {
  const site = await queryOne("SELECT * FROM sites WHERE key = ?", [siteKey]);
  if (!site) return { error: fail(404, "no such site") };
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== site.admin_token) return { error: fail(401, "bad admin token") };
  return { site };
}

/* ------------------------------------------------------------------ *
 * Destinations: where answers go
 * ------------------------------------------------------------------ */

function summarise(answer, site) {
  const face = { great: "🙂", ok: "😐", bad: "🙁" }[answer.answer];
  const label = ANSWERS[answer.answer] ?? answer.answer;
  return {
    face,
    label,
    title: `${face} ${label}, ${site.name}`,
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
async function resendAccessToken(dest, config) {
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
      refresh_token: config.refresh_token,
    }).toString(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    throw new Error(`resend refresh failed: ${payload.error_description ?? payload.error ?? res.status}`);
  }

  const next = {
    ...config,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? config.refresh_token,
    expires_at: Date.now() + (payload.expires_in ?? 900) * 1000,
  };
  await execute("UPDATE destinations SET config = ? WHERE id = ?", [JSON.stringify(next), dest.id]);
  return next.access_token;
}

async function sendEmail(dest, config, answer, site) {
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

async function sendSlack(dest, config, answer, site) {
  const s = summarise(answer, site);
  const lines = [`*${s.title}*`, `_${s.question}_`];
  if (s.note) lines.push(`> ${s.note}`);
  if (s.page) lines.push(`<${s.page}|${s.page}>`);
  const res = await fetch(config.webhook_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: s.title, blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }] }),
  });
  if (!res.ok) throw new Error(`slack ${res.status}: ${await res.text()}`);
}

async function sendDiscord(dest, config, answer, site) {
  const s = summarise(answer, site);
  const fields = [];
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

async function signPayload(secret, body) {
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

async function sendWebhook(dest, config, answer, site) {
  const body = JSON.stringify({
    site: site.key,
    question: answer.question ?? site.question,
    answer: answer.answer,
    note: answer.note ?? null,
    page: answer.page ?? null,
    at: answer.created_at ?? new Date().toISOString(),
  });
  const headers = { "content-type": "application/json", "user-agent": "smiles-edge" };
  if (config.secret) headers["x-smiles-signature"] = `sha256=${await signPayload(config.secret, body)}`;
  const res = await fetch(config.url, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);
}

const SENDERS = { email: sendEmail, slack: sendSlack, discord: sendDiscord, webhook: sendWebhook };

async function deliver(dest, answer, site) {
  const config = JSON.parse(dest.config);
  await SENDERS[dest.kind](dest, config, answer, site);
}

/** Fan out to every destination that wants this answer. Never throws. */
async function fanOut(site, answer) {
  const destinations = await queryAll("SELECT * FROM destinations WHERE site_key = ?", [site.key]);
  const wanted = destinations.filter((d) => !d.only_bad || answer.answer === "bad");
  const results = await Promise.allSettled(wanted.map((d) => deliver(d, answer, site)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.log(`[smiles] ${wanted[i].kind} destination ${wanted[i].id} failed: ${result.reason}`);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Slack / Discord install flow
 * ------------------------------------------------------------------ */

/*
 * Three providers, one flow. Slack and Discord are confidential clients with a
 * secret; Resend is a public client using PKCE, registered dynamically at
 * setup time so nobody has to click through a dashboard to create an app.
 */
const OAUTH = {
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
      if (!payload.access_token) throw new Error(payload.error_description ?? payload.error ?? "resend returned no token");
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

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkcePair() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

const callbackUrl = (req, kind) => new URL(`/v1/connect/${kind}/callback`, new URL(req.url).origin).toString();

async function connectStart(req, kind) {
  const provider = OAUTH[kind];
  if (!provider?.clientId()) return fail(501, `${kind} is not configured on this deployment`);

  const url = new URL(req.url);
  const siteKey = url.searchParams.get("site") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const site = await queryOne("SELECT * FROM sites WHERE key = ?", [siteKey]);
  if (!site || site.admin_token !== token) return fail(401, "bad site or admin token");

  // Anything the callback will need but OAuth won't carry for us.
  const extra = { to: url.searchParams.get("to") ?? "", from: url.searchParams.get("from") ?? "" };
  const state = randomKey(32);
  const pkce = provider.pkce ? await pkcePair() : { verifier: null, challenge: null };

  await execute(
    "INSERT INTO oauth_states (state, site_key, kind, verifier, extra) VALUES (?, ?, ?, ?, ?)",
    [state, siteKey, kind, pkce.verifier, JSON.stringify(extra)],
  );

  const authorize = new URL(provider.authorize);
  authorize.searchParams.set("client_id", provider.clientId());
  authorize.searchParams.set("scope", provider.scope);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("redirect_uri", callbackUrl(req, kind));
  if (provider.responseType) authorize.searchParams.set("response_type", "code");
  if (provider.pkce) {
    authorize.searchParams.set("code_challenge", pkce.challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
  }

  return Response.redirect(authorize.toString(), 302);
}

async function connectCallback(req, kind) {
  const provider = OAUTH[kind];
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(400, "missing code or state");

  const pending = await queryOne("SELECT * FROM oauth_states WHERE state = ? AND kind = ?", [state, kind]);
  if (!pending) return fail(400, "unknown or expired state");
  await execute("DELETE FROM oauth_states WHERE state = ?", [state]);

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
  const payload = await res.json().catch(() => ({}));

  let connection;
  try {
    connection = provider.destination(payload, JSON.parse(pending.extra ?? "{}"));
  } catch (err) {
    return fail(400, String(err.message ?? err));
  }

  await execute(
    "INSERT INTO destinations (site_key, kind, label, config, only_bad) VALUES (?, ?, ?, ?, 0)",
    [pending.site_key, connection.kind, connection.label, JSON.stringify(connection.config)],
  );

  const dashboard = env("SMILES_DASHBOARD_URL");
  return dashboard
    ? Response.redirect(`${dashboard}#connected=${kind}`, 302)
    : json({ ok: true, connected: kind, site: pending.site_key });
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

async function route(req) {
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
    if (!ANSWERS[answer]) return fail(400, "answer must be great, ok or bad");

    const site = await queryOne("SELECT * FROM sites WHERE key = ?", [siteKey]);
    if (!site) return fail(404, "no such site");

    const note = body.note ? String(body.note).slice(0, 2000) : null;
    const page = body.page ? String(body.page).slice(0, 500) : null;

    const rows = await queryAll(
      "INSERT INTO answers (site_key, answer, note, page) VALUES (?, ?, ?, ?) RETURNING id, created_at",
      [siteKey, answer, note, page],
    );

    await fanOut(site, { ...rows[0], answer, note, page, question: body.question });
    return json({ ok: true, id: rows[0]?.id });
  }

  // GET /v1/stats/:site
  if (method === "GET" && parts[0] === "v1" && parts[1] === "stats" && parts[2]) {
    const rows = await queryAll(
      "SELECT answer, COUNT(*) AS total FROM answers WHERE site_key = ? GROUP BY answer",
      [parts[2]],
    );
    const counts = { great: 0, ok: 0, bad: 0 };
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
      const recent = await queryOne(
        "SELECT COUNT(*) AS n FROM sites WHERE created_ip = ? AND created_at > datetime('now', '-1 hour')",
        [ip],
      );
      if ((recent?.n ?? 0) >= 3) return fail(429, "that's a few sites in one hour, try again later");
    }

    const key = await freeKey(body.key || name);
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
    if (await queryOne("SELECT key FROM sites WHERE key = ?", [key])) return fail(409, "that key is taken");

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
      const destinations = await queryAll(
        "SELECT id, kind, label, config, only_bad, created_at FROM destinations WHERE site_key = ? ORDER BY id",
        [siteKey],
      );
      return json({
        site: { key: site.key, name: site.name, question: site.question, created_at: site.created_at },
        destinations: destinations.map((d) => ({ ...d, config: JSON.parse(d.config), only_bad: !!d.only_bad })),
      });
    }

    if (rest.length === 0 && method === "PATCH") {
      const body = await readJson(req);
      await execute("UPDATE sites SET name = COALESCE(?, name), question = COALESCE(?, question) WHERE key = ?", [
        body.name ?? null,
        body.question ?? null,
        siteKey,
      ]);
      return json({ ok: true });
    }

    if (rest[0] === "answers" && method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
      const answers = await queryAll(
        `SELECT id, answer, note, page, created_at FROM answers WHERE site_key = ? ORDER BY id DESC LIMIT ${limit}`,
        [siteKey],
      );
      return json({ answers });
    }

    if (rest[0] === "destinations" && rest.length === 1 && method === "POST") {
      const body = await readJson(req);
      const kind = String(body.kind ?? "");
      if (!SENDERS[kind]) return fail(400, "kind must be email, slack, discord or webhook");
      const config = body.config ?? {};
      if (kind === "email" && !config.to) return fail(400, "email destinations need a `to` address");
      if ((kind === "slack" || kind === "discord") && !config.webhook_url) return fail(400, "need a webhook_url");
      if (kind === "webhook" && !config.url) return fail(400, "webhook destinations need a `url`");

      const rows = await queryAll(
        "INSERT INTO destinations (site_key, kind, label, config, only_bad) VALUES (?, ?, ?, ?, ?) RETURNING id",
        [siteKey, kind, body.label ?? null, JSON.stringify(config), body.only_bad ? 1 : 0],
      );
      return json({ ok: true, id: rows[0]?.id }, 201);
    }

    if (rest[0] === "destinations" && rest[1] && rest[2] === "test" && method === "POST") {
      const dest = await queryOne("SELECT * FROM destinations WHERE id = ? AND site_key = ?", [rest[1], siteKey]);
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
        return fail(502, String(err.message ?? err));
      }
    }

    if (rest[0] === "destinations" && rest[1] && rest.length === 2 && method === "DELETE") {
      await execute("DELETE FROM destinations WHERE id = ? AND site_key = ?", [rest[1], siteKey]);
      return json({ ok: true });
    }
  }

  // /v1/connect/:kind/start|callback
  if (parts[0] === "v1" && parts[1] === "connect" && OAUTH[parts[2]]) {
    if (parts[3] === "start" && method === "GET") return connectStart(req, parts[2]);
    if (parts[3] === "callback" && method === "GET") return connectCallback(req, parts[2]);
  }

  return fail(404, "not found");
}

BunnySDK.net.http.serve(async (req) => {
  try {
    return await route(req);
  } catch (err) {
    console.log(`[smiles] ${err?.stack ?? err}`);
    return fail(500, "something broke on our end");
  }
});
