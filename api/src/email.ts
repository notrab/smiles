import { env } from "./env";

/**
 * The deployment's own email, for sign-in links. Separate from the Resend
 * connections on destinations, which belong to the people using Smiles and
 * send their notifications, not ours.
 */
export async function sendPlatformEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not set, so sign-in emails cannot be sent");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: env("RESEND_FROM", "Smiles <onboarding@resend.dev>"),
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}
