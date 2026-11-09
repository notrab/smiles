import { connectCallback, connectStart, isProviderKind } from "./connect";
import { db } from "./db";
import { deliver, fanOut, isDestinationKind } from "./destinations";
import { env } from "./env";
import { sendPlatformEmail } from "./email";
import { clientIp, CORS, fail, json, message, randomKey, readJson } from "./http";
import { consumeLoginToken, createLoginToken } from "./sessions";
import { authorize, createSite, freeKey, looksLikeEmail } from "./sites";
import { isAnswerKey } from "./types";
import type { AnswerKey, DestinationRow, Json, SiteRow } from "./types";

/** /v1/sites/:site/... Everything here has already passed the admin token. */
async function siteRoutes(
  req: Request,
  url: URL,
  method: string,
  siteKey: string,
  rest: string[],
  site: SiteRow,
): Promise<Response | null> {
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
      return fail(502, message(err));
    }
  }

  if (rest[0] === "destinations" && rest[1] && rest.length === 2 && method === "DELETE") {
    await db.sql`DELETE FROM destinations WHERE id = ${rest[1]} AND site_key = ${siteKey}`.run();
    return json({ ok: true });
  }

  return null;
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/" || path === "/v1") return json({ service: "smiles", ok: true });

  // A Connect button needs credentials behind it, so the dashboard asks first.
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

    await fanOut(site, { answer, note, page, question: body.question, created_at: recorded?.created_at });
    return json({ ok: true, id: recorded?.id });
  }

  if (method === "GET" && parts[0] === "v1" && parts[1] === "stats" && parts[2]) {
    const rows = await db.sql<{ answer: AnswerKey; total: number }>`
      SELECT answer, COUNT(*) AS total FROM answers WHERE site_key = ${parts[2]} GROUP BY answer
    `.all();
    const counts: Record<AnswerKey, number> = { great: 0, ok: 0, bad: 0 };
    rows.forEach((row) => { counts[row.answer] = row.total; });
    const total = counts.great + counts.ok + counts.bad;
    return json({ ...counts, total, score: total ? Math.round((counts.great / total) * 100) : null });
  }

  // Magic link sign-in. The reply never says whether the address is known.
  if (method === "POST" && path === "/v1/login") {
    if (!env("RESEND_API_KEY")) return fail(501, "email sign-in is not configured on this deployment");

    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    if (!looksLikeEmail(email)) return fail(400, "that doesn't look like an email address");

    const sites = await db.sql<{ key: string; name: string }>`
      SELECT key, name FROM sites WHERE email = ${email} LIMIT 5
    `.all();

    if (sites.length > 0) {
      const origin = new URL(req.url).origin;
      const links: string[] = [];
      for (const site of sites) {
        const token = await createLoginToken(site.key);
        links.push(`${site.name}\n${origin}/v1/login/callback?token=${token}`);
      }

      try {
        await sendPlatformEmail(
          email,
          "Your Smiles sign-in link",
          `Open your dashboard:\n\n${links.join("\n\n")}\n\nThe link works once and expires in 15 minutes.`,
        );
      } catch {
        return fail(502, "the sign-in email could not be sent");
      }
    }

    return json({ ok: true });
  }

  if (method === "GET" && path === "/v1/login/callback") {
    const token = url.searchParams.get("token") ?? "";
    const opened = token ? await consumeLoginToken(token) : null;
    if (!opened) return fail(400, "that link has expired or been used already");

    const dashboard = env("SMILES_DASHBOARD_URL");
    // The session rides in the fragment, which browsers keep out of request logs.
    return dashboard
      ? Response.redirect(`${dashboard}#session=${opened.session}&site=${opened.site_key}`, 302)
      : json({ site: opened.site_key, session: opened.session });
  }

  if (method === "POST" && path === "/v1/signup") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!looksLikeEmail(email)) return fail(400, "that doesn't look like an email address");
    if (name.length < 2) return fail(400, "what should we call your site?");

    // Fail open without a client IP: better no rate limit than a dead form.
    const ip = clientIp(req);
    if (ip) {
      const recent = await db.sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM sites
        WHERE created_ip = ${ip} AND created_at > datetime('now', '-1 hour')
      `.first();
      if ((recent?.n ?? 0) >= 3) return fail(429, "that's a few sites in one hour, try again later");
    }

    const key = await freeKey(String(body.key || name));
    return json(
      await createSite({
        key,
        name,
        question: String(body.question || "How are we doing?").slice(0, 200),
        email,
        ip,
      }),
      201,
    );
  }

  if (method === "POST" && path === "/v1/sites") {
    const expected = env("SMILES_SIGNUP_TOKEN");
    if (!expected || req.headers.get("x-signup-token") !== expected) return fail(401, "bad signup token");

    const body = await readJson(req);
    const key = String(body.key ?? randomKey(10)).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (key.length < 3) return fail(400, "key must be at least 3 characters");
    if (await db.sql`SELECT key FROM sites WHERE key = ${key}`.first()) {
      return fail(409, "that key is taken");
    }

    return json(
      await createSite({
        key,
        name: String(body.name ?? key),
        question: String(body.question ?? "How are we doing?"),
        email: body.email,
        ip: clientIp(req),
      }),
      201,
    );
  }

  if (parts[0] === "v1" && parts[1] === "sites" && parts[2]) {
    const { site, error } = await authorize(req, parts[2]);
    if (error) return error;
    const handled = await siteRoutes(req, url, method, parts[2], parts.slice(3), site);
    if (handled) return handled;
  }

  if (parts[0] === "v1" && parts[1] === "connect" && parts[2] && isProviderKind(parts[2])) {
    if (parts[3] === "start" && method === "GET") return connectStart(req, parts[2]);
    if (parts[3] === "callback" && method === "GET") return connectCallback(req, parts[2]);
  }

  return fail(404, "not found");
}
