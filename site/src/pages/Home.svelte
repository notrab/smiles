<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Stats } from "../lib/api";
  import Chart from "../lib/Chart.svelte";
  import { config, configured } from "../lib/config";
  import Footer from "../lib/Footer.svelte";
  import Header from "../lib/Header.svelte";
  import { loadWidget } from "../lib/widget";

  let stats = $state<Stats | null>(null);

  const refresh = async () => {
    try {
      stats = await api.stats(config.site);
    } catch {
      /* the page is still a page without numbers */
    }
  };

  onMount(async () => {
    await loadWidget({ tab: "1", label: "Feedback", q: "How is this looking?" });
    window.Smiles?.onVote(() => setTimeout(refresh, 400));
    refresh();
  });
</script>

<Header current="home" />

<main>
  <section class="hero">
    <div class="wrap">
      <h1>Ask one question. Get a number that moves.</h1>
      <p class="lede">
        Smiles puts a single question in your product or your email, counts the answers, and sends every
        one of them wherever you work.
      </p>
      <p class="cta">
        <a class="btn" href="signup.html">Create your site</a>
        <a class="btn-link" href="how-it-works.html">See how it works</a>
      </p>
      <p class="demo-note">Free and open source. One script tag to install.</p>
    </div>
  </section>

  <section style="padding-top:0">
    <div class="wrap">
      <div class="demo">
        <div>
          <h2>Try it. Go on.</h2>
          <p class="muted">
            This is the real widget, wired to the real API. Pick a face and the numbers move, which is
            exactly what your dashboard does when an answer arrives.
          </p>
          {#if configured}
            <div data-smiles data-question="Enjoying the demo?" style="margin-top:24px"></div>
          {:else}
            <p class="empty" style="margin-top:24px">
              Not connected yet. Run <code>scripts/setup.sh</code> to deploy the API and widget.
            </p>
          {/if}
        </div>
        <div>
          <h4>The demo site</h4>
          <Chart {stats} onrefresh={refresh} />
        </div>
      </div>
    </div>
  </section>

  <section class="wash">
    <div class="wrap">
      <div class="section-head">
        <h2>Three ways to ask</h2>
        <p class="lede">Put the question where the experience actually happens.</p>
      </div>
      <div class="cards">
        <div class="card">
          <div class="card-art">
            <svg width="150" height="92" viewBox="0 0 150 92" aria-hidden="true">
              <rect x="1" y="1" width="148" height="90" rx="6" fill="#fff" stroke="#e8e8e8" />
              <rect x="14" y="14" width="54" height="6" rx="3" fill="#e8e8e8" />
              <rect x="14" y="30" width="104" height="4" rx="2" fill="#f1f1f1" />
              <rect x="14" y="42" width="88" height="4" rx="2" fill="#f1f1f1" />
              <rect x="76" y="66" width="66" height="26" rx="6" fill="#1a1a1a" />
              <rect x="88" y="77" width="42" height="4" rx="2" fill="#fff" opacity=".9" />
            </svg>
          </div>
          <h3>Tab</h3>
          <p>Sits in the corner of every page, ready when someone has an opinion. Best for a running read on the whole product.</p>
        </div>
        <div class="card">
          <div class="card-art">
            <svg width="150" height="92" viewBox="0 0 150 92" aria-hidden="true">
              <rect x="1" y="1" width="148" height="90" rx="6" fill="#fff" stroke="#e8e8e8" />
              <rect x="14" y="13" width="54" height="6" rx="3" fill="#e8e8e8" />
              <rect x="14" y="28" width="122" height="48" rx="6" fill="#fafafa" stroke="#eee" />
              <circle cx="53" cy="52" r="9" fill="none" stroke="#49b571" stroke-width="2.5" />
              <path d="M48,54 Q53,59 58,54" fill="none" stroke="#49b571" stroke-width="2.5" stroke-linecap="round" />
              <circle cx="75" cy="52" r="9" fill="none" stroke="#e3a53c" stroke-width="2.5" />
              <path d="M70,54 L80,54" stroke="#e3a53c" stroke-width="2.5" stroke-linecap="round" />
              <circle cx="97" cy="52" r="9" fill="none" stroke="#eb575c" stroke-width="2.5" />
              <path d="M92,56 Q97,51 102,56" fill="none" stroke="#eb575c" stroke-width="2.5" stroke-linecap="round" />
            </svg>
          </div>
          <h3>Inline</h3>
          <p>Drop it next to one thing, a checkout or an article, and find out how that one thing lands.</p>
        </div>
        <div class="card">
          <div class="card-art">
            <svg width="150" height="92" viewBox="0 0 150 92" aria-hidden="true">
              <rect x="1" y="8" width="148" height="76" rx="6" fill="#fff" stroke="#e8e8e8" />
              <path d="M1,14 L75,54 L149,14" fill="none" stroke="#e8e8e8" stroke-width="1.5" />
              <rect x="30" y="58" width="90" height="20" rx="6" fill="#fafafa" stroke="#eee" />
              <circle cx="53" cy="68" r="6.5" fill="none" stroke="#49b571" stroke-width="2" />
              <circle cx="75" cy="68" r="6.5" fill="none" stroke="#e3a53c" stroke-width="2" />
              <circle cx="97" cy="68" r="6.5" fill="none" stroke="#eb575c" stroke-width="2" />
            </svg>
          </div>
          <h3>Email</h3>
          <p>Three faces at the foot of a support reply. One click answers the question, with no login and no form.</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="section-head">
        <h2>Answers land where you work</h2>
        <p class="lede">Every answer, or only the unhappy ones. Your call, per destination.</p>
      </div>
      <div class="cards tight">
        <div class="card">
          <h3>Email</h3>
          <p class="muted">Through Resend. Connect the account, no API key to paste.</p>
        </div>
        <div class="card">
          <h3>Slack</h3>
          <p class="muted">A message in the channel you pick, the moment it arrives.</p>
        </div>
        <div class="card">
          <h3>Discord</h3>
          <p class="muted">An embed coloured by mood, in any channel webhook.</p>
        </div>
        <div class="card">
          <h3>Webhook</h3>
          <p class="muted">Your own endpoint, with an HMAC signature to check.</p>
        </div>
      </div>
    </div>
  </section>

  <div class="band">
    <div class="wrap">
      <h2>Stop guessing. Start counting.</h2>
      <p>Two minutes to install, then you always know how it is going.</p>
      <a class="btn" href="signup.html">Create your site</a>
    </div>
  </div>
</main>

<Footer />
