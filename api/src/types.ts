export type AnswerKey = "great" | "ok" | "bad";
export type DestinationKind = "email" | "slack" | "discord" | "webhook";
export type ProviderKind = "slack" | "discord" | "resend";

/** Whatever a third party sent back. Theirs to shape, ours to check. */
export type Json = Record<string, any>;

export interface SiteRow {
  key: string;
  name: string;
  question: string;
  admin_token: string;
  email: string | null;
  created_ip: string | null;
  created_at: string;
}

export interface DestinationRow {
  id: number;
  site_key: string;
  kind: DestinationKind;
  label: string | null;
  config: string;
  only_bad: number;
  created_at: string;
}

export interface OAuthStateRow {
  state: string;
  site_key: string;
  kind: string;
  verifier: string | null;
  extra: string | null;
}

export interface EmailConfig {
  to: string | string[];
  from?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface WebhookUrlConfig {
  webhook_url: string;
}

export interface CustomWebhookConfig {
  url: string;
  secret?: string;
}

export type DestinationConfig = EmailConfig | WebhookUrlConfig | CustomWebhookConfig;

/** One answer, on its way to a destination. */
export interface Delivery {
  answer: AnswerKey;
  note?: string | null;
  page?: string | null;
  question?: string;
  created_at?: string;
}

export const ANSWERS: Record<AnswerKey, string> = { great: "Awesome", ok: "Just OK", bad: "Not good" };
export const COLORS: Record<AnswerKey, string> = { great: "#49b571", ok: "#fec861", bad: "#eb575c" };
export const FACES: Record<AnswerKey, string> = { great: "🙂", ok: "😐", bad: "🙁" };

export const isAnswerKey = (value: string): value is AnswerKey => value in ANSWERS;
