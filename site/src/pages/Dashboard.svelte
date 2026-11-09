<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    type Answer,
    type Capabilities,
    type Credentials,
    type Destination,
    type SiteInfo,
    type Stats,
  } from "../lib/api";
  import Answers from "../lib/Answers.svelte";
  import Chart from "../lib/Chart.svelte";
  import { configured } from "../lib/config";
  import Destinations from "../lib/Destinations.svelte";
  import Footer from "../lib/Footer.svelte";
  import Header from "../lib/Header.svelte";
  import Notice from "../lib/Notice.svelte";
  import Tiles from "../lib/Tiles.svelte";

  let creds = $state<Credentials | null>(null);
  let form = $state({ key: "", token: "" });
  let site = $state<SiteInfo | null>(null);
  let destinations = $state<Destination[]>([]);
  let answers = $state<Answer[]>([]);
  let stats = $state<Stats | null>(null);
  let caps = $state<Capabilities | null>(null);
  // Remembered credentials are checked before anything renders, so nobody who
  // is already signed in gets a flash of the sign-in form.
  let loading = $state(true);
  let question = $state("");
  let loginEmail = $state("");
  let linkSent = $state(false);
  let sendingLink = $state(false);
  let flash = $state<{ message: string; tone: "good" | "bad" }>({ message: "", tone: "good" });

  const notify = (message: string, tone: "good" | "bad") => {
    flash = { message, tone };
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const store = (key: string, value?: string) => {
    try {
      if (value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* private mode: the session just will not be remembered */
    }
  };

  async function load() {
    if (!creds) return;
    try {
      const details = await api.site(creds);
      site = details.site;
      destinations = details.destinations;
      question = details.site.question;
      store("smiles.key", creds.key);
      store("smiles.token", creds.token);
      [stats, answers, caps] = await Promise.all([
        api.stats(creds.key),
        api.answers(creds).then((r) => r.answers),
        api.capabilities().catch(() => null),
      ]);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "bad");
      creds = null;
    }
  }

  function signIn() {
    if (!configured) return notify("config.js has no API URL yet. Run scripts/setup.sh.", "bad");
    if (!form.key.trim() || !form.token.trim()) {
      return notify("Both the site key and the admin token, please.", "bad");
    }
    creds = { key: form.key.trim(), token: form.token.trim() };
    load();
  }

  async function emailLink() {
    if (!configured) return notify("config has no API URL yet. Run scripts/setup.sh.", "bad");
    if (!loginEmail.trim()) return notify("Which address did you sign up with?", "bad");

    sendingLink = true;
    try {
      await api.requestLogin(loginEmail.trim());
      linkSent = true;
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      sendingLink = false;
    }
  }

  function signOut() {
    store("smiles.key");
    store("smiles.token");
    creds = null;
    site = null;
    flash = { message: "", tone: "good" };
  }

  async function saveQuestion() {
    if (!creds) return;
    try {
      await api.updateQuestion(creds, question.trim());
      notify("Question saved.", "good");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "bad");
    }
  }

  onMount(() => {
    const hash = new URLSearchParams(location.hash.slice(1));

    const connected = hash.get("connected");
    if (connected) {
      notify(`Connected ${connected}.`, "good");
      history.replaceState(null, "", location.pathname);
    }

    const session = hash.get("session");
    const fromLink = hash.get("site");
    if (session && fromLink) {
      history.replaceState(null, "", location.pathname);
      creds = { key: fromLink, token: session };
      form = { key: fromLink, token: session };
      load().finally(() => (loading = false));
      return;
    }

    try {
      const key = localStorage.getItem("smiles.key");
      const token = localStorage.getItem("smiles.token");
      if (key && token) {
        creds = { key, token };
        form = { key, token };
        load().finally(() => (loading = false));
        return;
      }
    } catch {
      /* nothing remembered, the sign-in form it is */
    }
    loading = false;
  });
</script>

<Header current="app" />

<main>
  <section style="padding-top:40px">
    <div class="wrap narrow">
      <Notice tone={flash.tone} message={flash.message} />

      {#if loading}
        <p class="empty">One moment...</p>
      {:else if !site}
        <div class="panel">
          <h3>Open your dashboard</h3>

          {#if linkSent}
            <p class="muted">
              If that address has a site, a sign-in link is on its way. It works once and expires in
              15 minutes.
            </p>
          {:else}
            <p class="muted">We will email you a link. No password to remember.</p>
            <div class="field">
              <label for="login-email">Your email</label>
              <input
                id="login-email"
                type="email"
                bind:value={loginEmail}
                placeholder="you@example.com"
                autocomplete="email"
              />
            </div>
            <button class="btn" onclick={emailLink} disabled={sendingLink}>
              {sendingLink ? "Sending..." : "Email me a link"}
            </button>
          {/if}

          <div style="margin-top:26px;padding-top:22px;border-top:1px solid var(--line)">
            <h4>Or use your site key</h4>
            <div class="field">
              <label for="signin-key">Site key</label>
              <input id="signin-key" bind:value={form.key} placeholder="acme" autocomplete="off" />
            </div>
            <div class="field">
              <label for="signin-token">Admin token</label>
              <input id="signin-token" type="password" bind:value={form.token} autocomplete="off" />
            </div>
            <button class="btn btn-small btn-quiet" onclick={signIn}>Open</button>
          </div>

          <p class="hint" style="margin-top:20px">
            No site yet? <a href="signup.html">Create one</a>, it takes a few seconds.
          </p>
        </div>
      {:else if creds}
        <div class="row" style="align-items:baseline;margin-bottom:24px">
          <h1 style="font-size:32px;margin:0">{site.name}</h1>
          <p class="row-fixed" style="margin:0;text-align:right">
            <button class="btn btn-small btn-quiet" onclick={signOut}>Sign out</button>
          </p>
        </div>

        <Tiles {stats} />

        <div class="panel">
          <h4>The breakdown</h4>
          <Chart {stats} />
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Your question</h3></div>
          <div class="row">
            <div class="field" style="margin:0">
              <label for="question">Asked on every widget</label>
              <input id="question" bind:value={question} placeholder="How are we doing?" />
            </div>
            <p class="row-fixed" style="margin:0">
              <button class="btn btn-small" onclick={saveQuestion}>Save</button>
            </p>
          </div>
          <div class="field" style="margin-top:20px">
            <label for="snippet">Install snippet</label>
            <pre style="margin:0"><code id="snippet">{api.snippet(site.key)}</code></pre>
            <p class="hint">
              Add <code>&lt;div data-smiles&gt;&lt;/div&gt;</code> anywhere in the page for an inline question.
            </p>
          </div>
        </div>

        <Destinations {creds} {destinations} {caps} onchange={load} onflash={notify} />
        <Answers {answers} />
      {/if}
    </div>
  </section>
</main>

<Footer />
