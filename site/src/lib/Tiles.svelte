<script lang="ts">
  import type { Stats } from "./api";

  let { stats }: { stats: Stats | null } = $props();
</script>

<div class="tiles">
  <div class="tile">
    <span class="tile-label">Satisfaction</span>
    <span class="tile-value">{stats?.score === null || !stats ? "n/a" : `${stats.score}%`}</span>
    <span class="tile-sub">answers that were awesome</span>
  </div>
  <div class="tile">
    <span class="tile-label">Answers</span>
    <span class="tile-value">{stats?.total ?? 0}</span>
    <span class="tile-sub">all time</span>
  </div>
  <div class="tile">
    <span class="tile-label">Not good</span>
    <span class="tile-value">{stats?.bad ?? 0}</span>
    <span class="tile-sub">worth a reply</span>
  </div>
</div>
