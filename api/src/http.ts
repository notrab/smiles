import type { Json } from "./types";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-signup-token",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-max-age": "86400",
};

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

export const fail = (status: number, message: string): Response => json({ error: message }, status);

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const clientIp = (req: Request): string =>
  (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

export function randomKey(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

export async function readJson(req: Request): Promise<Json> {
  try {
    return (await req.json()) as Json;
  } catch {
    return {};
  }
}
