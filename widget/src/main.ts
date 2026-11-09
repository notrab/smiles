/*
 * Smiles widget host, a Bunny Edge Script.
 *
 * GET /<site-key>.js   the widget, wired to that site
 * GET /                a one-line usage note
 *
 * Env: SMILES_API_URL (e.g. https://smiles-api.b-cdn.net)
 *
 * The widget itself is widget/src/client.ts, bundled into __WIDGET_SOURCE__ at
 * build time. Per-site settings ride in front of it as a config global, so the
 * bundle stays identical for every site and stays cacheable.
 */
import * as BunnySDK from "@bunny.net/edgescript-sdk";

const API_URL = (): string => (Deno.env.get("SMILES_API_URL") ?? "").replace(/\/+$/, "");

const USAGE = `Smiles widget host.

  <script src="<this-host>/<your-site-key>.js" async></script>

Add ?tab=1 for the corner tab, or drop <div data-smiles></div> in the page for
an inline question. Both talk to ${API_URL() || "the Smiles API"}.
`;

BunnySDK.net.http.serve((req: Request): Response => {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/([a-z0-9-]{3,64})\.js$/i);

  if (!match) {
    return new Response(USAGE, {
      status: url.pathname === "/" ? 200 : 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const tab = url.searchParams.get("tab");
  const config = {
    site: match[1],
    api: API_URL(),
    question: url.searchParams.get("q") ?? "How are we doing?",
    label: url.searchParams.get("label") ?? "Feedback",
    tab: tab === null ? false : tab === "1" || tab === "" ? true : tab,
  };

  const body = `window.__SMILES_CONFIG__=${JSON.stringify(config)};\n${__WIDGET_SOURCE__}`;

  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
});
