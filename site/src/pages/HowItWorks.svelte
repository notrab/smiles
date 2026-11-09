<script lang="ts">
  import { onMount } from "svelte";
  import { configured } from "../lib/config";
  import Footer from "../lib/Footer.svelte";
  import Header from "../lib/Header.svelte";
  import { loadWidget } from "../lib/widget";

  const steps = [
    {
      title: "Write the question",
      body: `One question, in your words. "How was your checkout?" "Did that answer help?" Short questions get answered. Surveys get closed.`,
    },
    {
      title: "Paste one script tag",
      body: "Your site key is already in it. Add ?tab=1 for the corner tab, or drop a div anywhere you want the question inline.",
    },
    {
      title: "People answer with a face",
      body: "Awesome, just OK, not good. That is the whole survey. Anyone who wants to say more gets a comment box after they pick, and most will not bother, which is fine.",
    },
    {
      title: "You get a score, and the answers",
      body: "Your score is the share of answers that were awesome. Every answer also goes wherever you point it: email, Slack, Discord, or your own webhook. Ship a change, watch the number, follow up on the unhappy ones the same day.",
    },
  ];

  onMount(() => loadWidget({ tab: "1", label: "Feedback", q: "How is this looking?" }));
</script>

<Header current="how" />

<main>
  <section class="hero">
    <div class="wrap">
      <h1>How it works</h1>
      <p class="lede">One question, one click to answer, one number to watch.</p>
    </div>
  </section>

  <section style="padding-top:0">
    <div class="wrap narrow">
      <div class="panel" style="padding:32px">
        <div class="steps">
          {#each steps as step, i (step.title)}
            <div class="step">
              <span class="step-num">{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>

                {#if i === 1}
                  <pre><code>&lt;script src="https://your-widget-host/your-key.js?tab=1" async&gt;&lt;/script&gt;

&lt;!-- or inline, wherever you want it --&gt;
&lt;div data-smiles data-question="How was your checkout?"&gt;&lt;/div&gt;</code></pre>
                {/if}

                {#if i === 2 && configured}
                  <div data-smiles data-question="How was that explanation?" style="margin:20px 0 4px"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <div class="band">
    <div class="wrap">
      <h2>Two minutes to install</h2>
      <p>Then you never have to wonder how it is going.</p>
      <a class="btn" href="signup.html">Create your site</a>
    </div>
  </div>
</main>

<Footer />
