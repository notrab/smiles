/*
 * Smiles widget host, a Bunny Edge Script.
 *
 * GET /<site_key>.js   the widget, wired to that site
 * GET /                a one-line usage note
 *
 * Env: SMILES_API_URL (e.g. https://smiles-api.b-cdn.net)
 *
 * The widget itself is the WIDGET string below. It ships as-is to every
 * visitor, so it stays dependency-free and small.
 */
import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.12.0";

const WIDGET = `(function () {
  'use strict';

  var config = __CONFIG__;

  var ANSWERS = [
    { key: 'great', label: 'Awesome',  color: '#49b571', mouth: 'M14,25 Q24,35 34,25' },
    { key: 'ok',    label: 'Just OK',  color: '#fec861', mouth: 'M14,28 L34,28' },
    { key: 'bad',   label: 'Not Good', color: '#eb575c', mouth: 'M14,31 Q24,22 34,31' }
  ];

  var listeners = [];

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (kid) { node.appendChild(kid); });
    return node;
  }

  function face(answer) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '48');
    svg.setAttribute('aria-hidden', 'true');

    var ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', '24'); ring.setAttribute('cy', '24'); ring.setAttribute('r', '21');
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'currentColor'); ring.setAttribute('stroke-width', '2.5');
    svg.appendChild(ring);

    [16, 32].forEach(function (x) {
      var eye = document.createElementNS(ns, 'circle');
      eye.setAttribute('cx', String(x)); eye.setAttribute('cy', '18'); eye.setAttribute('r', '2.6');
      eye.setAttribute('fill', 'currentColor');
      svg.appendChild(eye);
    });

    var mouth = document.createElementNS(ns, 'path');
    mouth.setAttribute('d', answer.mouth);
    mouth.setAttribute('fill', 'none'); mouth.setAttribute('stroke', 'currentColor');
    mouth.setAttribute('stroke-width', '2.5'); mouth.setAttribute('stroke-linecap', 'round');
    svg.appendChild(mouth);

    return svg;
  }

  function styles() {
    if (document.getElementById('smiles-styles')) return;
    var css = [
      '.smiles{font:400 15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;text-align:center}',
      '.smiles-q{margin:0 0 14px;font-size:16px;font-weight:500;color:#1a1a1a}',
      '.smiles-faces{display:flex;justify-content:center;gap:10px}',
      '.smiles-face{display:flex;flex-direction:column;align-items:center;gap:7px;padding:13px 16px;border:1px solid #e8e8e8;border-radius:10px;background:#fff;color:#c2c2c2;font:inherit;font-size:12.5px;line-height:1;cursor:pointer;transition:color .15s,border-color .15s,background .15s}',
      '.smiles-face:hover{background:#fafafa}',
      '.smiles-face[data-picked=\"true\"],.smiles-face:hover{border-color:currentColor}',
      '.smiles-face span{color:#6b6b6b}',
      '.smiles-follow{margin-top:14px}',
      '.smiles-follow textarea{display:block;width:100%;max-width:400px;margin:0 auto;min-height:70px;padding:10px 12px;border:1px solid #dedede;border-radius:8px;color:#1a1a1a;font:inherit;font-size:14px;resize:vertical;box-sizing:border-box}',
      '.smiles-follow textarea:focus{outline:none;border-color:#1a1a1a}',
      '.smiles-follow button{margin-top:10px;padding:9px 20px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;font:inherit;font-weight:500;font-size:14px;cursor:pointer}',
      '.smiles-thanks{margin:0;color:#49b571;font-weight:500}',
      '.smiles-tab{position:fixed;right:20px;bottom:0;z-index:9999;width:304px;max-width:calc(100vw - 40px);border:1px solid #e8e8e8;border-bottom:0;border-radius:12px 12px 0 0;background:#fff;box-shadow:0 -4px 24px rgba(0,0,0,.09);transform:translateY(calc(100% - 42px));transition:transform .25s ease}',
      '.smiles-tab[data-open=\"true\"]{transform:translateY(0)}',
      '.smiles-tab-handle{display:block;width:100%;height:42px;border:0;border-radius:11px 11px 0 0;background:#1a1a1a;color:#fff;font:500 14px/42px Inter,ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;cursor:pointer}',
      '.smiles-tab .smiles{padding:20px 18px 22px}'
    ].join('');
    document.head.appendChild(el('style', { id: 'smiles-styles', type: 'text/css', text: css }));
  }

  function post(path, body) {
    return fetch(config.api + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });  // never break the host page
  }

  function Widget(root, options) {
    var opts = options || {};
    var question = opts.question || root.getAttribute('data-question') || config.question;

    styles();
    root.classList.add('smiles');
    root.innerHTML = '';

    var faces = el('div', { class: 'smiles-faces' });
    var follow = el('div', { class: 'smiles-follow' });
    follow.hidden = true;

    ANSWERS.forEach(function (answer) {
      var btn = el('button', { class: 'smiles-face', type: 'button', 'aria-label': answer.label });
      btn.style.color = answer.color;
      btn.appendChild(face(answer));
      btn.appendChild(el('span', { text: answer.label }));
      btn.addEventListener('click', function () { vote(answer, btn); });
      faces.appendChild(btn);
    });

    var comment = el('textarea', { placeholder: "Anything you'd like to add? (optional)" });
    var send = el('button', { type: 'button', text: 'Send' });
    follow.appendChild(comment);
    follow.appendChild(el('div', {}, [send]));

    root.appendChild(el('p', { class: 'smiles-q', text: question }));
    root.appendChild(faces);
    root.appendChild(follow);

    var picked = null;
    var sent = false;
    var timer = null;

    function vote(answer, btn) {
      picked = answer;
      Array.prototype.forEach.call(faces.children, function (node) {
        node.setAttribute('data-picked', node === btn ? 'true' : 'false');
        node.style.opacity = node === btn ? '1' : '.45';
      });
      follow.hidden = false;
      comment.focus();
      // The answer is sent once and once only: on Send, when the page goes
      // away, or after a minute of nothing. Someone who picks a face and
      // wanders off still counts, and nobody ever counts twice.
      timer = setTimeout(function () { deliver(comment.value.trim()); }, 60000);
      window.addEventListener('pagehide', onLeave);
      document.addEventListener('visibilitychange', onHidden);
    }

    function onHidden() { if (document.visibilityState === 'hidden') onLeave(); }

    function onLeave() { deliver(comment.value.trim(), true); }

    function deliver(note, beacon) {
      if (sent || !picked) return;
      sent = true;
      clearTimeout(timer);
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onHidden);

      var payload = {
        site: config.site,
        question: question,
        answer: picked.key,
        note: note || null,
        page: location.href
      };

      if (beacon && navigator.sendBeacon) {
        // A page being torn down cannot wait on fetch; a beacon survives it.
        navigator.sendBeacon(
          config.api + '/v1/answer',
          // text/plain keeps the beacon a simple request \u2014 a beacon cannot
          // answer a CORS preflight, and the API parses the body either way.
          new Blob([JSON.stringify(payload)], { type: 'text/plain;charset=UTF-8' })
        );
      } else {
        post('/v1/answer', payload);
      }

      listeners.forEach(function (fn) { fn(payload); });
    }

    send.addEventListener('click', function () {
      deliver(comment.value.trim());
      root.innerHTML = '';
      root.appendChild(el('p', { class: 'smiles-thanks', text: 'Thanks, noted!' }));
    });

    return root;
  }

  var Smiles = {
    site: config.site,
    api: config.api,
    onVote: function (fn) { listeners.push(fn); },
    stats: function () {
      return fetch(config.api + '/v1/stats/' + config.site).then(function (r) { return r.json(); });
    },
    inline: function (root, options) { return new Widget(root, options); },
    tab: function (options) {
      styles();
      var opts = options || {};
      var host = el('div', { class: 'smiles-tab', 'data-open': 'false' });
      var handle = el('button', { class: 'smiles-tab-handle', type: 'button', text: opts.label || config.label });
      var body = el('div', {});
      host.appendChild(handle);
      host.appendChild(body);
      document.body.appendChild(host);
      new Widget(body, opts);
      handle.addEventListener('click', function () {
        host.setAttribute('data-open', host.getAttribute('data-open') === 'true' ? 'false' : 'true');
      });
      return host;
    },
    boot: function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-smiles]'), function (node) {
        if (!node.getAttribute('data-smiles-ready')) {
          node.setAttribute('data-smiles-ready', '1');
          new Widget(node, {});
        }
      });
      if (config.tab) Smiles.tab({ question: config.tab === true ? config.question : config.tab });
    }
  };

  window.Smiles = Smiles;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Smiles.boot);
  else Smiles.boot();
}());
`;

const API_URL = () => (Deno.env.get("SMILES_API_URL") ?? "").replace(/\/+$/, "");

const USAGE = `Smiles widget host.

  <script src="<this-host>/<your-site-key>.js" async></script>

Add ?tab=1 for the corner tab, or drop <div data-smiles></div> in the page for
an inline question. Both talk to ${API_URL() || "the Smiles API"}.
`;

BunnySDK.net.http.serve((req) => {
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

  return new Response(WIDGET.replace("__CONFIG__", JSON.stringify(config)), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
});
