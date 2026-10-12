<script>
  import PRRow from './PRRow.svelte';
  import SearchBar from './SearchBar.svelte';
  import { annotatedPRsStore, filtersStore, sortStore, settingsStore, viewModeStore, setQuery } from '../lib/stores.js';
  import { STATUS, STATE } from '../lib/status.js';
  import { buildQueryMatcher } from '../lib/query.js';

  export let onMarkViewed = () => {};
  export let onMarkUnseen = () => {};
  export let onToggleWatch = () => {};
  // Changing the merged window changes what gets fetched.
  export let onScopeChange = () => {};

  const MERGED_WINDOWS = [1, 3, 7, 14, 30];

  const statusOrder = { [STATUS.NEW]: 0, [STATUS.UPDATED]: 1, [STATUS.SEEN]: 2 };

  function sortValue(pr, key) {
    switch (key) {
      case 'updated': return new Date(pr.updatedAt).getTime();
      case 'created': return new Date(pr.createdAt || pr.updatedAt).getTime();
      case 'repo': return pr.repo;
      case 'author': return pr.author;
      case 'comments': return pr.commentCount || 0;
      case 'changes': return (pr.additions || 0) + (pr.deletions || 0);
      default: return 0;
    }
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  $: openPRs = $annotatedPRsStore.filter((p) => (p.state || STATE.OPEN) === STATE.OPEN);
  $: mergedPRs = $annotatedPRsStore.filter((p) => p.state === STATE.MERGED);
  $: openUnseen = openPRs.filter((p) => p.status !== STATUS.SEEN).length;
  $: mergedUnseen = mergedPRs.filter((p) => p.status !== STATUS.SEEN).length;
  $: merged = $viewModeStore === 'merged';
  $: pool = merged ? mergedPRs : openPRs;
  $: mergedDays = $settingsStore.mergedDays;
  $: mergedWindows = MERGED_WINDOWS.includes(mergedDays) ? MERGED_WINDOWS : [...MERGED_WINDOWS, mergedDays].sort((a, b) => a - b);

  // Rebuilt only when the query text changes, not on every viewed/observed update.
  $: queryMatch = buildQueryMatcher($filtersStore.text);
  $: visible = queryMatch ? pool.filter(queryMatch) : pool;
  $: hidden = queryMatch ? pool.filter((p) => !queryMatch(p)) : [];

  $: sorted = (() => {
    const key = $sortStore.key;
    const dir = $sortStore.dir === 'asc' ? 1 : -1;
    return [...visible].sort((a, b) => {
      // New/updated always above seen, regardless of sort.
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      const primary = cmp(sortValue(a, key), sortValue(b, key)) * dir;
      if (primary !== 0) return primary;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  })();

  function setMergedDays(days) {
    settingsStore.update((s) => ({ ...s, mergedDays: days }));
    onScopeChange();
  }
</script>

<section class="list">
  <div class="tabs" role="tablist">
    <button type="button" role="tab" class="tab" class:active={!merged} aria-selected={!merged} on:click={() => viewModeStore.set('open')}>
      Open
      <span class="count">{openPRs.length}</span>
      {#if openUnseen > 0}<span class="badge">{openUnseen} new</span>{/if}
    </button>
    <div class="tab-wrap" class:active={merged}>
      <button type="button" role="tab" class="tab" class:active={merged} aria-selected={merged} on:click={() => viewModeStore.set('merged')}>
        Merged
        {#if mergedUnseen > 0}<span class="badge merged-badge">{mergedUnseen} new</span>{/if}
      </button>
      <select aria-label="Merged window" value={mergedDays} on:change={(e) => setMergedDays(Number(e.currentTarget.value))}>
        {#each mergedWindows as d}<option value={d}>{d === 1 ? 'last day' : `last ${d} days`}</option>{/each}
      </select>
    </div>
  </div>

  <SearchBar shown={visible.length} total={pool.length} />

  {#if pool.length === 0}
    <div class="empty">
      {#if merged}
        Nothing merged in the last {mergedDays === 1 ? 'day' : `${mergedDays} days`}.
      {:else}
        No open PRs in what you track yet. Try <strong>Tracking</strong> in the header, or refresh.
      {/if}
    </div>
  {:else if visible.length === 0}
    <div class="empty">
      Nothing matches your search. <button type="button" class="link" on:click={() => setQuery('')}>Clear it</button>
    </div>
  {:else}
    {#each sorted as pr (pr.id)}
      <PRRow {pr} {onMarkViewed} {onMarkUnseen} {onToggleWatch} />
    {/each}
  {/if}

  {#if hidden.length > 0}
    <details class="hidden">
      <summary>{hidden.length} more hidden by your search. Show them</summary>
      <div class="hidden-list">
        {#each hidden as pr (pr.id)}
          <PRRow {pr} {onMarkViewed} {onMarkUnseen} {onToggleWatch} />
        {/each}
      </div>
    </details>
  {/if}
</section>

<style>
  .list {
    border: 1px solid #d0d7de;
    border-radius: 8px;
    background: #fff;
  }
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 8px 12px 0;
    border-bottom: 1px solid #d0d7de;
    flex-wrap: wrap;
  }
  .tab, .tab-wrap { margin-bottom: -1px; }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: inherit;
    font-size: 14px;
    padding: 7px 12px 9px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: #57606a;
    cursor: pointer;
  }
  .tab:hover { color: #1f2328; }
  .tab.active { color: #1f2328; font-weight: 600; border-bottom-color: #fd8c73; }
  .tab-wrap { display: inline-flex; align-items: center; gap: 2px; }
  .tab-wrap .tab { margin-bottom: 0; }
  .tab-wrap.active .tab { border-bottom-color: #8250df; }
  .tab-wrap select {
    font: inherit;
    font-size: 12px;
    color: #57606a;
    padding: 2px 4px;
    margin-bottom: 4px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    background: #fff;
  }
  .count { font-size: 12px; font-weight: 500; color: #57606a; }
  .badge {
    background: #0969da;
    color: #fff;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 700;
  }
  .badge.merged-badge { background: #8250df; }
  .empty { padding: 40px 16px; text-align: center; color: #57606a; }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: #0969da;
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .hidden { border-top: 1px solid #eef0f3; background: #f6f8fa; border-radius: 0 0 8px 8px; }
  .hidden summary { cursor: pointer; padding: 9px 14px; font-size: 12px; color: #57606a; }
  .hidden-list { border-top: 1px solid #eef0f3; opacity: 0.75; }
</style>
