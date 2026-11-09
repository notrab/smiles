<script lang="ts">
  import { api } from "../lib/api";
  import { configured } from "../lib/config";
  import Footer from "../lib/Footer.svelte";
  import Header from "../lib/Header.svelte";
  import Notice from "../lib/Notice.svelte";

  let name = $state("");
  let email = $state("");
  let question = $state("");
  let error = $state("");
  let busy = $state(false);
  let created = $state<{ key: string; admin_token: string } | null>(null);

  async function submit() {
    if (!configured) return (error = "This deployment has no API configured yet.");
    if (!name.trim()) return (error = "What should we call your site?");
    if (!email.trim()) return (error = "We need an email address.");

    error = "";
    busy = true;
    try {
      const result = await api.signUp({
        name: name.trim(),
        email: email.trim(),
        question: question.trim() || "How are we doing?",
      });
      try {
        localStorage.setItem("smiles.key", result.key);
        localStorage.setItem("smiles.token", result.admin_token);
      } catch {
        /* the tokens are on screen either way */
      }
      created = result;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<Header current="signup" />

<main>
  <section class="hero" style="padding-bottom:40px">
    <div class="wrap">
      <h1>Create your site</h1>
      <p class="lede">Takes a few seconds. You get a site key, a dashboard, and a script tag to paste.</p>
    </div>
  </section>

  <section style="padding-top:0">
    <div class="wrap" style="max-width:520px">
      {#if created}
        <div class="panel" style="padding:28px">
          <h3 style="font-size:20px">You are set up</h3>
          <p class="muted">
            Save the admin token somewhere safe. It is the password to your dashboard, and it is not
            shown again.
          </p>
          <div class="field" style="margin-top:22px">
            <label for="su-key">Site key</label>
            <pre style="margin:0"><code id="su-key">{created.key}</code></pre>
          </div>
          <div class="field">
            <label for="su-token">Admin token</label>
            <pre style="margin:0"><code id="su-token">{created.admin_token}</code></pre>
          </div>
          <div class="field">
            <label for="su-snippet">Your script tag</label>
            <pre style="margin:0"><code id="su-snippet">{api.snippet(created.key)}</code></pre>
          </div>
          <a class="btn" href="app.html" style="width:100%;text-align:center">Open my dashboard</a>
        </div>
      {:else}
        <div class="panel" style="padding:28px">
          <Notice tone="bad" message={error} />
          <div class="field">
            <label for="su-name">What are you measuring?</label>
            <input id="su-name" bind:value={name} placeholder="Acme checkout" autocomplete="organization" />
          </div>
          <div class="field">
            <label for="su-email">Your email</label>
            <input id="su-email" type="email" bind:value={email} placeholder="you@example.com" autocomplete="email" />
            <p class="hint">Used to reach you about your site. No list, no newsletter.</p>
          </div>
          <div class="field">
            <label for="su-question">The question you want to ask</label>
            <input id="su-question" bind:value={question} placeholder="How are we doing?" />
          </div>
          <button class="btn" style="width:100%" onclick={submit} disabled={busy}>
            {busy ? "Creating..." : "Create my site"}
          </button>
          <p class="hint" style="margin-top:14px;text-align:center">
            Already have a site? <a href="app.html">Log in</a>.
          </p>
        </div>
      {/if}
    </div>
  </section>
</main>

<Footer />
