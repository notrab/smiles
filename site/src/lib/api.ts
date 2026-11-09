import { config } from "./config";

export type AnswerKey = "great" | "ok" | "bad";
export type DestinationKind = "email" | "slack" | "discord" | "webhook";

export interface Stats {
  great: number;
  ok: number;
  bad: number;
  total: number;
  score: number | null;
}

export interface Answer {
  id: number;
  answer: AnswerKey;
  note: string | null;
  page: string | null;
  created_at: string;
}

export interface Destination {
  id: number;
  kind: DestinationKind;
  label: string | null;
  config: Record<string, string>;
  only_bad: boolean;
}

export interface SiteInfo {
  key: string;
  name: string;
  question: string;
  created_at: string;
}

export interface Capabilities {
  connect: Record<"slack" | "discord" | "resend", boolean>;
  resend_api_key: boolean;
}

export interface Credentials {
  key: string;
  token: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(config.api + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
}

const authed = (creds: Credentials, body?: unknown, method = body ? "POST" : "GET"): RequestInit => ({
  method,
  headers: {
    authorization: `Bearer ${creds.token}`,
    ...(body ? { "content-type": "application/json" } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
});

export const api = {
  stats: (site: string) => request<Stats>(`/v1/stats/${site}`),

  capabilities: () => request<Capabilities>("/v1/config"),

  /** Ask for a sign-in link. The reply never says whether the address is known. */
  requestLogin: (email: string) =>
    request<{ ok: true }>("/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),

  signUp: (body: { name: string; email: string; question: string }) =>
    request<{ key: string; admin_token: string }>("/v1/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  site: (creds: Credentials) =>
    request<{ site: SiteInfo; destinations: Destination[] }>(`/v1/sites/${creds.key}`, authed(creds)),

  answers: (creds: Credentials, limit = 25) =>
    request<{ answers: Answer[] }>(`/v1/sites/${creds.key}/answers?limit=${limit}`, authed(creds)),

  updateQuestion: (creds: Credentials, question: string) =>
    request(`/v1/sites/${creds.key}`, { ...authed(creds, { question }), method: "PATCH" }),

  addDestination: (
    creds: Credentials,
    body: { kind: DestinationKind; config: Record<string, string>; only_bad: boolean },
  ) => request(`/v1/sites/${creds.key}/destinations`, authed(creds, body)),

  testDestination: (creds: Credentials, id: number) =>
    request(`/v1/sites/${creds.key}/destinations/${id}/test`, { ...authed(creds), method: "POST" }),

  removeDestination: (creds: Credentials, id: number) =>
    request(`/v1/sites/${creds.key}/destinations/${id}`, { ...authed(creds), method: "DELETE" }),

  connectUrl: (kind: string, creds: Credentials, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ site: creds.key, token: creds.token, ...extra });
    return `${config.api}/v1/connect/${kind}/start?${params}`;
  },

  snippet: (key: string) => `<script src="${config.widget}/${key}.js?tab=1" async><\/script>`,
};
