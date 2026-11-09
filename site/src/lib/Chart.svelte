<script lang="ts">
  import type { Stats } from "./api";

  let { stats, onrefresh }: { stats: Stats | null; onrefresh?: () => void } = $props();

  const rows = [
    { key: "great", label: "Awesome", fill: "fill-great" },
    { key: "ok", label: "Just OK", fill: "fill-ok" },
    { key: "bad", label: "Not good", fill: "fill-bad" },
  ] as const;

  const total = $derived(stats?.total ?? 0);
  const percent = (value: number) => (total ? Math.round((value / total) * 100) : 0);
</script>

<div class="chart">
  {#each rows as row (row.key)}
    <div class="chart-row">
      <span>{row.label}</span>
      <span class="bar"><i class={row.fill} style="width:{percent(stats?.[row.key] ?? 0)}%"></i></span>
      <span>{stats?.[row.key] ?? 0}</span>
    </div>
  {/each}

  <div class="chart-total">
    <span class="score">{stats?.score === null || !stats ? "n/a" : `${stats.score}%`}</span>
    <p>
      satisfaction across {total} {total === 1 ? "answer" : "answers"}
      {#if onrefresh}
        &middot; <a href="#refresh" onclick={(e) => { e.preventDefault(); onrefresh(); }}>refresh</a>
      {/if}
    </p>
  </div>
</div>
