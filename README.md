# Smiles

A one-question customer-satisfaction widget, running entirely on bunny.net.

Ask people how something went, they answer with one of three faces, and you get
a score that moves plus the answers themselves wherever you want them: email,
Slack, Discord, or your own endpoint.

It is also a small, complete example of four bunny.net products working
together: Edge Scripting, Bunny Database, Bunny Storage and the CDN. Two
TypeScript Edge Scripts, four static pages, one SQL file. No servers, no
framework, no runtime dependencies.

## The shape of it

```
visitor's page ──> widget Edge Script      /<site-key>.js
                        │
                        ▼  POST /v1/answer
                   API Edge Script ──> Bunny Database    sites · answers · destinations
                        │
                        └─> Resend · Slack · Discord · your webhook

marketing pages + dashboard ──> Bunny Storage (static site + CDN)
```

Four moving parts:

| Piece | Lives in | What it is |
| --- | --- | --- |
| Widget | `widget/src/main.ts` | Edge Script that serves the widget as `/<site-key>.js`, with the site key already baked in |
| The widget itself | `widget/src/client.ts` | What runs in a visitor's browser, bundled into the host script at build time |
| API | `api/src/main.ts` | Edge Script: records answers, aggregates scores, fans out to destinations, handles the connect flows |
| Data | `migrations/*.sql` | Bunny Database, queried with [`@bunny.net/database-client`](https://www.npmjs.com/package/@bunny.net/database-client) |
| Site | `site/` | Four static pages deployed to Bunny Storage and served from the CDN: `index`, `how-it-works`, `signup`, and the `app` dashboard |

The pages are hand-written HTML over one stylesheet
(`site/assets/css/style.css`), with no webfonts and no build.

## Build and deploy

Everything comes from npm and bundles with esbuild, so each Edge Script ships as
one self-contained file with nothing to resolve at runtime. No deno needed.

```bash
npm install
npm run check          # tsc --noEmit over both scripts
npm run build          # bundles dist/api.js and dist/widget.js
npm run deploy         # build, then deploy both
npm run deploy:api     # or just one of them
npm run deploy:widget
```

Queries read as SQL, bound rather than concatenated:

```ts
const site = await db.sql<SiteRow>`SELECT * FROM sites WHERE key = ${siteKey}`.first();
```

The browser widget is TypeScript too. `scripts/build.mjs` bundles
`widget/src/client.ts` into one minified IIFE and injects it into the host
script, which serves it with a per-site config in front. The bundle is identical
for every site, so the CDN can cache it.

## Set it up

```bash
npm install -g @bunny.net/cli
bunny login
scripts/setup.sh
```

That creates the database and applies the migrations, builds and deploys both
Edge Scripts, creates the static site, writes `site/config.js` with the live
URLs, deploys the site, and creates a `demo` site key so the home page has
something to show. Re-running it reuses whatever already exists.

Setup also registers a Resend OAuth client for you. Resend supports dynamic
client registration, so connecting email is a button in the dashboard rather
than an API key you have to mint and paste. Slack and Discord credentials are
optional and go in `.env` before you run setup; without them those two still
work by pasting a webhook URL. See
[integrations/README.md](integrations/README.md).

## Use it

Open the site and create one from the sign-up form on `/signup.html`:
name it, give an email, write your question, and you get a site key, an admin
token, and the script tag to paste. The token is the password to your dashboard,
and it is shown once.

```html
<script src="https://YOUR-WIDGET-HOST/your-key.js?tab=1" async></script>
```

`?tab=1` gives the corner tab. Anywhere you drop `<div data-smiles></div>` you
get an inline question instead, and `data-question` on that div overrides the
wording for that spot. `window.Smiles` is there too: `Smiles.tab()`,
`Smiles.inline(el)`, `Smiles.stats()`.

Then open `/app.html` and connect where the answers should go. Sign-up stashes
your key and token in the browser, so the dashboard opens straight up on the
machine you signed up from.

Scripts and back-office work can create sites without the form, using the
sign-up token that setup put in `.env`:

```bash
curl -X POST "$API_URL/v1/sites" \
  -H "content-type: application/json" \
  -H "x-signup-token: $SMILES_SIGNUP_TOKEN" \
  -d '{"key":"acme","name":"Acme","question":"How was your checkout?"}'
```

## The API

Public:

| | |
| --- | --- |
| `POST /v1/signup` | `{name, email, question}`, creates a site and returns its key and admin token |
| `POST /v1/answer` | `{site, answer, note, page, question}`, records and fans out |
| `GET /v1/stats/:site` | counts and satisfaction score |

Owner, with `Authorization: Bearer <admin_token>`:

| | |
| --- | --- |
| `GET /v1/sites/:site` | the site and its destinations |
| `PATCH /v1/sites/:site` | change the question or name |
| `GET /v1/sites/:site/answers` | recent answers |
| `POST /v1/sites/:site/destinations` | add a destination |
| `POST /v1/sites/:site/destinations/:id/test` | send a test |
| `DELETE /v1/sites/:site/destinations/:id` | remove one |

Creating a site needs `X-Signup-Token`, which `setup.sh` generates and stores in
`.env` and on the API script.

## Answers count once

The widget records an answer when someone picks a face, but only once, and only
after they've had a chance to type. It sends on **Send**, when the page goes away
(via `sendBeacon`), or after a minute, whichever comes first. Someone who picks a
face and wanders off still counts; nobody ever counts twice.

## Day to day

```bash
bunny db shell -e "SELECT answer, COUNT(*) FROM answers GROUP BY answer"
npm run deploy:api                                   # ship an API change
npm run deploy:widget                                # ship a widget change
bunny sites deploy ./site                            # ship the pages
bunny sites deployments publish --previous --force   # roll the site back
```

Local preview of the pages (the widget stays inert until `site/config.js` has
real URLs in it):

```bash
python3 -m http.server 4173 --directory site
```

`site/config.js` is generated by setup and git-ignored, so each deployment keeps
its own URLs; `site/config.example.js` shows the shape. Every page reads it and
degrades to an inert demo when it is missing, so a fresh clone still renders.

## Contributing

Issues and pull requests are welcome. `npm install`, then `npm run check` and
`npm run build` before you push; the pages need neither, so `npm run dev` and a
browser is the whole loop for those. Keep it boring.

## License

MIT, see [LICENSE](LICENSE).
