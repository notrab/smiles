#!/usr/bin/env bash
#
# Provisions Smiles on bunny.net, end to end:
#
#   1. a Bunny Database:        sites, answers, destinations
#   2. the API Edge Script:     records answers, fans them out
#   3. the widget Edge Script:  serves /<site-key>.js
#   4. a static site (Storage): marketing pages + dashboard
#   5. a demo site row:         so the home page has something to show
#
# Safe to re-run: anything that already exists is reused.
#
# Usage:  scripts/setup.sh [name]        (default name: smiles)

set -euo pipefail

NAME="${1:-${SMILES_NAME:-smiles}}"
REGION="${SMILES_REGION:-DE}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v bunny >/dev/null || { echo "The bunny CLI is missing: npm install -g @bunny.net/cli"; exit 1; }
command -v node  >/dev/null || { echo "node is needed to read the CLI's JSON output."; exit 1; }
bunny api GET /user --output json >/dev/null 2>&1 || { echo "Not logged in. Run: bunny login"; exit 1; }

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Pull the first *.b-cdn.net hostname out of whatever the CLI printed. Matching
# the raw text rather than parsing JSON keeps this working when the CLI mixes in
# a notice (an update banner, say) alongside the JSON.
hostname_from_output() {
  # `|| true` so "no match" is an empty answer, not a pipefail that kills the run.
  grep -oE '[a-z0-9][a-z0-9.-]*\.b-cdn\.net' | head -n 1 || true
}

# ---------------------------------------------------------------- database

if [ -f .bunny/database.json ]; then
  say "Database: already linked ($(node -p 'require("./.bunny/database.json").name'))"
else
  say "Creating the database…"
  bunny db create --name "$NAME" --primary "$REGION" --link --token --save-env --output json >/dev/null
fi

say "Applying migrations…"
bunny db migrations apply --force

# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${BUNNY_DATABASE_URL:-}" ] || { echo "BUNNY_DATABASE_URL missing from .env"; exit 1; }

# ---------------------------------------------------------------- static site

say "Creating the static site…"
SITE_JSON="$(bunny sites create "$NAME" --region "$REGION" --link --output json 2>/dev/null || true)"
SITE_HOST="$(printf '%s' "$SITE_JSON" | hostname_from_output)"
if [ -z "$SITE_HOST" ]; then
  SITE_HOST="$(bunny sites show "$NAME" --output json | hostname_from_output)"
fi
SITE_URL="https://$SITE_HOST"
echo "  $SITE_URL"

# ---------------------------------------------------------------- edge scripts

create_script() {
  local dir="$1" script_name="$2"
  if [ ! -f "$dir/.bunny/script.json" ]; then
    (cd "$dir" && bunny scripts create "$script_name" --type standalone --link --output json >/dev/null)
  fi
  # `show` is the reliable source for the hostname: a freshly created script
  # does not always report its pull zone in the create response.
  (cd "$dir" && bunny scripts show --output json)
}

say "Creating the API Edge Script…"
API_HOST="$(create_script api "$NAME-api" | hostname_from_output)"
[ -n "$API_HOST" ] || { echo "Could not read the API script hostname."; exit 1; }
API_URL="https://$API_HOST"
echo "  $API_URL"

say "Creating the widget Edge Script…"
WIDGET_HOST="$(create_script widget "$NAME-widget" | hostname_from_output)"
[ -n "$WIDGET_HOST" ] || { echo "Could not read the widget script hostname."; exit 1; }
WIDGET_URL="https://$WIDGET_HOST"
echo "  $WIDGET_URL"

# A token that gates site creation, generated once and kept in .env.
if ! grep -q '^SMILES_SIGNUP_TOKEN=' .env 2>/dev/null; then
  echo "SMILES_SIGNUP_TOKEN=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')" >> .env
fi

# Resend supports dynamic client registration, so the OAuth app registers
# itself against this deployment's callback, so there is nothing to click in a dashboard.
if ! grep -q '^RESEND_CLIENT_ID=' .env 2>/dev/null; then
  say "Registering the Resend OAuth client…"
  REGISTRATION="$(curl -sS -X POST https://api.resend.com/oauth/register \
    -H 'content-type: application/json' \
    -d "{\"client_name\":\"Smiles\",\"redirect_uris\":[\"$API_URL/v1/connect/resend/callback\"],\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"],\"token_endpoint_auth_method\":\"none\",\"scope\":\"emails:send\"}" || true)"
  CLIENT_ID="$(printf '%s' "$REGISTRATION" | node -e 'let r="";process.stdin.on("data",d=>r+=d).on("end",()=>{try{process.stdout.write(JSON.parse(r).client_id??"")}catch{}})')"
  if [ -n "$CLIENT_ID" ]; then
    echo "RESEND_CLIENT_ID=$CLIENT_ID" >> .env
    echo "  client_id: $CLIENT_ID"
  else
    echo "  registration did not return a client_id. Email destinations can still use a RESEND_API_KEY."
    echo "  response: $(printf '%s' "$REGISTRATION" | head -c 300)"
  fi
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

say "Setting environment variables…"
(
  cd api
  bunny scripts env set BUNNY_DATABASE_URL "$BUNNY_DATABASE_URL"
  bunny scripts env set BUNNY_DATABASE_AUTH_TOKEN "$BUNNY_DATABASE_AUTH_TOKEN" --secret
  bunny scripts env set SMILES_SIGNUP_TOKEN "$SMILES_SIGNUP_TOKEN" --secret
  bunny scripts env set SMILES_DASHBOARD_URL "$SITE_URL/app.html"
  # Optional integrations: set whichever are present in .env.
  set_if_present() {
    local name="$1" value="${!1:-}"
    [ -n "$value" ] || return 0
    shift
    bunny scripts env set "$name" "$value" "$@"
  }
  set_if_present RESEND_CLIENT_ID
  set_if_present RESEND_API_KEY --secret
  set_if_present RESEND_FROM
  set_if_present SLACK_CLIENT_ID
  set_if_present SLACK_CLIENT_SECRET --secret
  set_if_present DISCORD_CLIENT_ID
  set_if_present DISCORD_CLIENT_SECRET --secret
)
(cd widget && bunny scripts env set SMILES_API_URL "$API_URL")

say "Deploying the edge scripts…"
(cd api && bunny scripts deploy src/main.js)
(cd widget && bunny scripts deploy src/main.js)

# ---------------------------------------------------------------- demo site row

say "Creating the demo site…"
DEMO_KEY="${SMILES_DEMO_KEY:-demo}"
DEMO_JSON="$(curl -sS -X POST "$API_URL/v1/sites" \
  -H "content-type: application/json" \
  -H "x-signup-token: $SMILES_SIGNUP_TOKEN" \
  -d "{\"key\":\"$DEMO_KEY\",\"name\":\"Smiles demo\",\"question\":\"Enjoying the clone?\"}" || true)"
DEMO_TOKEN="$(printf '%s' "$DEMO_JSON" | node -e 'let r="";process.stdin.on("data",d=>r+=d).on("end",()=>{try{process.stdout.write(JSON.parse(r).admin_token??"")}catch{}})')"

if [ -n "$DEMO_TOKEN" ]; then
  grep -q '^SMILES_DEMO_ADMIN_TOKEN=' .env || echo "SMILES_DEMO_ADMIN_TOKEN=$DEMO_TOKEN" >> .env
  echo "  site key: $DEMO_KEY"
  echo "  admin token: $DEMO_TOKEN  (also saved to .env)"
else
  echo "  already exists (or the API is still warming up), reusing '$DEMO_KEY'"
fi

# ---------------------------------------------------------------- publish the site

say "Writing site/config.js…"
cat > site/config.js <<CONFIG
/* Written by scripts/setup.sh. Edit there, not here. */
window.SMILES = {
  api: "$API_URL",
  widget: "$WIDGET_URL",
  site: "$DEMO_KEY",
};
CONFIG

say "Deploying the site…"
bunny sites deploy ./site --site "$NAME"

say "Done."
cat <<SUMMARY

  Site        $SITE_URL
  Dashboard   $SITE_URL/app.html
  API         $API_URL
  Widget      $WIDGET_URL/$DEMO_KEY.js?tab=1

  Sign in to the dashboard with the site key and admin token above.
  Create more sites with:

    curl -X POST $API_URL/v1/sites \\
      -H "content-type: application/json" \\
      -H "x-signup-token: \$SMILES_SIGNUP_TOKEN" \\
      -d '{"key":"acme","name":"Acme","question":"How are we doing?"}'

SUMMARY
