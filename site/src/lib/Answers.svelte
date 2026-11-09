<script lang="ts">
  import type { Answer } from "./api";

  let { answers }: { answers: Answer[] } = $props();

  const LABELS = { great: "Awesome", ok: "Just OK", bad: "Not good" } as const;
  const when = (iso: string) => iso.replace("T", " ").slice(0, 16);
</script>

<div class="panel">
  <div class="panel-head"><h3>Recent answers</h3></div>

  {#if answers.length === 0}
    <p class="empty">Nothing yet.</p>
  {:else}
    {#each answers as answer (answer.id)}
      <div class="answer-row">
        <span><span class="pill pill-{answer.answer}">{LABELS[answer.answer]}</span></span>
        <span>{#if answer.note}{answer.note}{:else}<span class="empty">no comment</span>{/if}</span>
        <time>{when(answer.created_at)}</time>
      </div>
    {/each}
  {/if}
</div>
