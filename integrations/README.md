# Connecting destinations

Four kinds, all configured per site from the dashboard (`/app.html`).

## Email (Resend)

Resend is a public OAuth 2.1 client here, with **dynamic client registration**:
`scripts/setup.sh` registers the app against your deployment's callback URL and
saves the resulting `RESEND_CLIENT_ID`. There is nothing to create by hand.

In the dashboard, pick **Email**, type the address to notify and the `from`
address, then hit **Connect Resend**. Resend shows its own consent screen, and
the callback stores the connection as a destination. No API key changes hands,
and the connection can be revoked from Resend's team settings at any time.

A few details worth knowing:

- The scope requested is `emails:send`, which permits `POST /emails` and nothing
  else.
- Access tokens last 15 minutes and refresh tokens rotate on every use, so each
  refresh writes the new pair back onto the destination row.
- The `from` address must be on a domain you have verified with Resend. Leave it
  blank to fall back to whatever `RESEND_FROM` is set to on the API script.

**The API-key way**, if you'd rather not use OAuth: put the key in `.env` before
running setup (or `cd api && bunny scripts env set RESEND_API_KEY re_... --secret`
afterwards):

```
RESEND_API_KEY=re_...
RESEND_FROM=Smiles <smiles@yourdomain.com>
```

With no key and no OAuth client configured, the dashboard asks for a key per
destination instead.

## Slack

**The one-click way.** Create the app once, then every site connects with a button.

1. [Create a Slack app from a manifest](https://api.slack.com/apps?new_app=1),
   paste `slack-app-manifest.json`, and replace the redirect URL host with your
   deployed API host.
2. From *Basic Information*, copy the client ID and secret into `.env`:

   ```
   SLACK_CLIENT_ID=1234...
   SLACK_CLIENT_SECRET=abcd...
   ```
3. Re-run `scripts/setup.sh` (or set the two variables on the API script and
   redeploy). The dashboard now shows **Add to Slack**, which asks Slack for an
   incoming webhook and stores it as a destination.

**The no-app way.** In any Slack workspace you administer, add an *Incoming
Webhooks* integration, copy the URL, and paste it into the dashboard as a Slack
destination. No app, no credentials.

## Discord

Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL,
then paste it into the dashboard. Answers arrive as an embed coloured by mood.

For a one-click **Add to Discord** button instead, create an application at
[discord.com/developers](https://discord.com/developers/applications), add
`https://YOUR-API-HOST/v1/connect/discord/callback` as a redirect, and set
`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`. The `webhook.incoming` scope
hands back a webhook for whichever channel the installer picks.

## Custom webhook

Any URL that accepts a POST. The body:

```json
{
  "site": "acme",
  "question": "How was your checkout?",
  "answer": "bad",
  "note": "The card form rejected my postcode.",
  "page": "https://acme.com/checkout",
  "at": "2026-08-27 16:20:11"
}
```

Set a signing secret and each request also carries
`x-smiles-signature: sha256=<HMAC-SHA256 of the raw body>`. Verify it before
trusting the payload:

```js
const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.slice(7)));
```

## Only the unhappy ones

Every destination has an **only unhappy answers** switch. With it on, the
destination hears about `bad` answers and nothing else, which suits a support
channel you don't want to flood.
