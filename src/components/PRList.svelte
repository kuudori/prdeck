<script>
  import PRRow from './PRRow.svelte';
  import { filteredPRsStore, annotatedPRsStore } from '../lib/stores.js';

  export let onMarkViewed = () => {};

  function sortKey(pr) {
    const sOrder = { NEW: 0, UPDATED: 1, SEEN: 2 };
    return [sOrder[pr.status] ?? 9, -new Date(pr.updatedAt).getTime()];
  }

  $: sorted = [...$filteredPRsStore].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });

  $: total = $annotatedPRsStore.length;
  $: shown = sorted.length;
</script>

<section class="list">
  <div class="header">
    {shown} of {total} PRs
    {#if shown === 0 && total > 0}
      <span class="hint">— filters hide all results</span>
    {/if}
  </div>

  {#if total === 0}
    <div class="empty">
      No PRs cached yet. Configure scopes in Settings and refresh.
    </div>
  {:else}
    {#each sorted as pr (pr.id)}
      <PRRow {pr} {onMarkViewed} />
    {/each}
  {/if}
</section>

<style>
  .list {
    border: 1px solid #ddd;
    border-radius: 6px;
    background: white;
  }
  .header {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #eee;
    font-size: 0.85rem;
    color: #555;
    background: #fafafa;
  }
  .hint {
    color: #999;
  }
  .empty {
    padding: 2rem;
    text-align: center;
    color: #777;
  }
</style>
