/*
 * Smiles API, a Bunny Edge Script. Routes live in routes.ts.
 *
 * Env: BUNNY_DATABASE_URL, BUNNY_DATABASE_AUTH_TOKEN, SMILES_SIGNUP_TOKEN,
 *      SMILES_DASHBOARD_URL, RESEND_CLIENT_ID, RESEND_API_KEY, RESEND_FROM,
 *      SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
 */
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import { fail } from "./http";
import { route } from "./routes";

BunnySDK.net.http.serve(async (req: Request): Promise<Response> => {
  try {
    return await route(req);
  } catch {
    return fail(500, "something broke on our end");
  }
});
