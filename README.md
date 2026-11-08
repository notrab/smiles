# Smiles

A one-question customer-satisfaction widget, running entirely on bunny.net.

Ask people how something went, they answer with one of three faces, and you get
a score that moves plus the answers themselves wherever you want them: email,
Slack, Discord, or your own endpoint.

It is also a small, complete example of four bunny.net products working
together: Edge Scripting, Bunny Database, Bunny Storage and the CDN. No servers,
no build step, no framework, no dependencies.

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

Four moving parts, no servers, no build step:

| Piece | Lives in | What it is |
| --- | --- | --- |
| Widget | `widget/src/main.js` | Edge Script that serves the widget as `/<site-key>.js`, with the site key already baked in |
| API | `api/src/main.js` | Edge Script: records answers, aggregates scores, fans out to destinations, handles the Slack/Discord install flow |
| Data | `migrations/*.sql` | Bunny Database (libsql), talked to over its HTTP endpoint, no client library |
| Site | `site/` | Four static pages deployed to Bunny Storage and served from the CDN: `index`, `how-it-works`, `signup`, and the `app` dashboard |

Both Edge Scripts are single dependency-free files, so `bunny scripts deploy
src/main.js` ships them as they are. The pages are hand-written HTML over one
stylesheet (`site/assets/css/style.css`) with no webfonts and no build.

## Set it up

```bash
npm install -g @bunny.net/cli
bunny login
scripts/setup.sh
```

That creates the database and applies the migrations, creates and deploys both
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
cd api && bunny scripts deploy src/main.js      # ship an API change
cd widget && bunny scripts deploy src/main.js   # ship a widget change
bunny sites deploy ./site                       # ship the pages
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

Issues and pull requests are welcome. There is nothing to install and nothing to
build: edit the file, run the local preview above, and for the Edge Scripts
`bunny scripts deploy src/main.js` from `api/` or `widget/`. Keep it boring, keep
it dependency-free.

## License

MIT, see [LICENSE](LICENSE).
