import { db } from "./db";
import { fail, randomKey } from "./http";
import { sessionIsValid } from "./sessions";
import type { SiteRow } from "./types";

export const looksLikeEmail = (value: unknown): boolean =>
  /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(value ?? ""));

/** A key from whatever the visitor typed: "Acme Inc." -> "acme-inc". */
const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

export async function freeKey(preferred: string): Promise<string> {
  const base = slugify(preferred);
  if (base.length < 3) return randomKey(8);
  for (const candidate of [base, `${base}-${randomKey(3)}`, `${base}-${randomKey(5)}`]) {
    const taken = await db.sql`SELECT key FROM sites WHERE key = ${candidate}`.first();
    if (!taken) return candidate;
  }
  return randomKey(10);
}

export interface NewSite {
  key: string;
  name: string;
  question: string;
  email?: string | null;
  ip?: string | null;
}

export async function createSite(input: NewSite): Promise<{ key: string; admin_token: string }> {
  const adminToken = randomKey(40);
  await db.sql`
    INSERT INTO sites (key, name, question, admin_token, email, created_ip)
    VALUES (${input.key}, ${input.name}, ${input.question}, ${adminToken}, ${input.email ?? null}, ${input.ip || null})
  `.run();
  return { key: input.key, admin_token: adminToken };
}

type Authorized = { site: SiteRow; error?: undefined } | { site?: undefined; error: Response };

/** The admin token is the machine credential; a session comes from a magic link. */
export async function authorize(req: Request, siteKey: string): Promise<Authorized> {
  const site = await db.sql<SiteRow>`SELECT * FROM sites WHERE key = ${siteKey}`.first();
  if (!site) return { error: fail(404, "no such site") };

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return { error: fail(401, "not signed in") };
  if (bearer === site.admin_token) return { site };
  if (await sessionIsValid(bearer, siteKey)) return { site };

  return { error: fail(401, "not signed in") };
}
