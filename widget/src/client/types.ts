export type AnswerKey = "great" | "ok" | "bad";

export interface AnswerOption {
  key: AnswerKey;
  label: string;
  color: string;
  mouth: string;
}

export interface WidgetConfig {
  site: string;
  api: string;
  question: string;
  label: string;
  /** false, true (use the site question), or a question of its own. */
  tab: boolean | string;
}

export interface Payload {
  site: string;
  question: string;
  answer: AnswerKey;
  note: string | null;
  page: string;
}

export interface WidgetOptions {
  question?: string;
  label?: string;
}

export interface Stats {
  great: number;
  ok: number;
  bad: number;
  total: number;
  score: number | null;
}

declare global {
  interface Window {
    __SMILES_CONFIG__?: WidgetConfig;
    Smiles?: unknown;
  }
}

export const config: WidgetConfig = window.__SMILES_CONFIG__ ?? {
  site: "",
  api: "",
  question: "How are we doing?",
  label: "Feedback",
  tab: false,
};

export const ANSWERS: AnswerOption[] = [
  { key: "great", label: "Awesome", color: "#49b571", mouth: "M14,25 Q24,35 34,25" },
  { key: "ok", label: "Just OK", color: "#e3a53c", mouth: "M14,28 L34,28" },
  { key: "bad", label: "Not good", color: "#eb575c", mouth: "M14,31 Q24,22 34,31" },
];
