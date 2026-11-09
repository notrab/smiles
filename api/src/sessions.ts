import { db } from "./db";
import { randomKey } from "./http";

const LOGIN_TOKEN_MINUTES = 15;
const SESSION_DAYS = 30;

/** A single use link token for one site. */
export async function createLoginToken(siteKey: string): Promise<string> {
  const token = randomKey(40);
  await db.sql`
    INSERT INTO login_tokens (token, site_key, expires_at)
    VALUES (${token}, ${siteKey}, datetime('now', ${`+${LOGIN_TOKEN_MINUTES} minutes`}))
  `.run();
  return token;
}

/** Spend a link token and open a session. Returns null when it is expired or already used. */
export async function consumeLoginToken(token: string): Promise<{ site_key: string; session: string } | null> {
  const row = await db.sql<{ site_key: string }>`
    SELECT site_key FROM login_tokens WHERE token = ${token} AND expires_at > datetime('now')
  `.first();
  if (!row) return null;

  await db.sql`DELETE FROM login_tokens WHERE token = ${token}`.run();

  const session = randomKey(40);
  await db.sql`
    INSERT INTO sessions (token, site_key, expires_at)
    VALUES (${session}, ${row.site_key}, datetime('now', ${`+${SESSION_DAYS} days`}))
  `.run();

  return { site_key: row.site_key, session };
}

export async function sessionIsValid(token: string, siteKey: string): Promise<boolean> {
  const row = await db.sql`
    SELECT token FROM sessions
    WHERE token = ${token} AND site_key = ${siteKey} AND expires_at > datetime('now')
  `.first();
  return Boolean(row);
}
