<script lang="ts">
  let { tone = "", message = "" }: { tone?: "good" | "bad" | ""; message?: string } = $props();
</script>

{#if message}
  <div class="notice {tone}">{message}</div>
{/if}
