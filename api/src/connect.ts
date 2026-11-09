import { db } from "./db";
import { env } from "./env";
import { fail, json, message, randomKey } from "./http";
import type { DestinationConfig, DestinationKind, Json, OAuthStateRow, ProviderKind, SiteRow } from "./types";

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

// Slack and Discord are confidential clients with a secret; Resend is a public
// client using PKCE, registered at setup time so there is no app to click
// together in a dashboard.
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

export const isProviderKind = (value: string): value is ProviderKind => value in OAUTH;

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

export async function connectStart(req: Request, kind: ProviderKind): Promise<Response> {
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

export async function connectCallback(req: Request, kind: ProviderKind): Promise<Response> {
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
    return fail(400, message(err));
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
