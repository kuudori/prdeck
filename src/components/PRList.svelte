<script>
  import PRRow from './PRRow.svelte';
  import {
    annotatedPRsStore,
    filtersStore,
    sortStore,
    settingsStore,
    tokenStore,
    viewModeStore,
    resetFilters,
  } from '../lib/stores.js';
  import { STATUS, STATE, hasToken as tokenPresent, hasScope as scopePresent } from '../lib/status.js';
  import { buildQueryMatcher } from '../lib/query.js';

  export let onMarkViewed = () => {};
  export let onMarkUnseen = () => {};

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

  function exclusionReason(pr, f, queryMatch) {
    if (f.repoInclude.length && !f.repoInclude.includes(pr.repo)) return `repo not in include list`;
    if (f.repoExclude.includes(pr.repo)) return `repo excluded`;
    if (f.authors.length && !f.authors.includes(pr.author)) return `author not in include list`;
    if ((f.authorsExclude || []).includes(pr.author)) return `author excluded`;
    if (f.ciStates.length && !f.ciStates.includes(pr.ciState)) return `CI: ${pr.ciState.toLowerCase()}`;
    if (f.reviewDecisions.length && !f.reviewDecisions.includes(pr.reviewDecision)) return `review: ${(pr.reviewDecision || 'none').toLowerCase()}`;
    if (f.statuses.length && !f.statuses.includes(pr.status)) return `status: ${pr.status.toLowerCase()}`;
    if (f.draft === 'only' && !pr.isDraft) return `not a draft`;
    if (f.draft === 'exclude' && pr.isDraft) return `is a draft`;
    if (queryMatch && !queryMatch(pr)) return `query`;
    return null;
  }

  $: openPRs = $annotatedPRsStore.filter((p) => (p.state || STATE.OPEN) === STATE.OPEN);
  $: mergedPRs = $annotatedPRsStore.filter((p) => p.state === STATE.MERGED);

  $: openUnseenCount = openPRs.filter((p) => p.status === STATUS.NEW || p.status === STATUS.UPDATED).length;
  $: mergedUnseenCount = mergedPRs.filter((p) => p.status === STATUS.NEW || p.status === STATUS.UPDATED).length;

  $: pool = $viewModeStore === 'merged' ? mergedPRs : openPRs;

  // Rebuilt only when the query text changes — not on every viewed/observed update.
  $: queryMatch = buildQueryMatcher($filtersStore.text);

  let visible = [];
  let hidden = [];
  $: {
    const v = [];
    const h = [];
    for (const pr of pool) {
      const reason = exclusionReason(pr, $filtersStore, queryMatch);
      if (reason) h.push({ pr, reason });
      else v.push(pr);
    }
    visible = v;
    hidden = h;
  }

  $: sorted = (() => {
    const key = $sortStore.key;
    const dir = $sortStore.dir === 'asc' ? 1 : -1;
    return [...visible].sort((a, b) => {
      // NEW/UPDATED always above SEEN, regardless of user sort.
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      const primary = cmp(sortValue(a, key), sortValue(b, key)) * dir;
      if (primary !== 0) return primary;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  })();

  $: total = pool.length;

  function setView(v) {
    viewModeStore.set(v);
  }
  $: hasScope = scopePresent($settingsStore);
  $: hasToken = tokenPresent($tokenStore);
</script>

<section class="list">
  <div class="tabs">
    <button
      type="button"
      class="tab"
      class:active={$viewModeStore === 'open'}
      on:click={() => setView('open')}>
      opened
      {#if openUnseenCount > 0}<span class="badge">{openUnseenCount}</span>{/if}
    </button>
    <button
      type="button"
      class="tab"
      class:active={$viewModeStore === 'merged'}
      on:click={() => setView('merged')}>
      recently merged
      {#if mergedUnseenCount > 0}<span class="badge">{mergedUnseenCount}</span>{/if}
    </button>
    <span class="meta">{visible.length} of {total}{hidden.length > 0 ? ` · ${hidden.length} hidden` : ''}</span>
    {#if hidden.length > 0}
      <button type="button" class="link" on:click={resetFilters}>clear filters</button>
    {/if}
  </div>

  {#if total === 0}
    <div class="empty">
      {#if !hasToken}
        It's empty. Add a GitHub token in the sidebar to start.
      {:else if !hasScope}
        It's empty, please configure in the sidebar.
      {:else if $viewModeStore === 'merged'}
        Nothing merged in the last {$settingsStore.mergedDays} days.
      {:else}
        No open PRs match your scope yet. Try refreshing.
      {/if}
    </div>
  {:else}
    {#each sorted as pr (pr.id)}
      <PRRow {pr} {onMarkViewed} {onMarkUnseen} />
    {/each}

    {#if hidden.length > 0}
      <details class="hidden-details">
        <summary>{hidden.length} hidden — why?</summary>
        <div class="hidden-list">
          {#each hidden as { pr, reason } (pr.id)}
            <div class="hidden-item">
              <div class="reason-bar">hidden: {reason}</div>
              <PRRow {pr} {onMarkViewed} {onMarkUnseen} />
            </div>
          {/each}
        </div>
      </details>
    {/if}
  {/if}
</section>

<style>
  .list {
    border: 1px solid #ddd;
    border-radius: 6px;
    background: white;
    overflow: hidden;
  }
  .tabs {
    display: flex;
    gap: 0.2rem;
    align-items: center;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid #eee;
    background: #fafafa;
  }
  .tab {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    font: inherit;
    font-size: 0.8rem;
    color: #555;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .tab:hover { background: white; }
  .tab.active {
    background: white;
    border-color: #d0d7de;
    color: #1f2328;
    font-weight: 600;
  }
  .badge {
    background: #0969da;
    color: white;
    font-size: 0.68rem;
    padding: 0.05rem 0.38rem;
    border-radius: 999px;
    font-weight: 700;
    min-width: 1rem;
    text-align: center;
  }
  .meta {
    margin-left: auto;
    font-size: 0.76rem;
    color: #666;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: #0969da;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
  }
  .empty {
    padding: 2.5rem 1rem;
    text-align: center;
    color: #777;
  }
  .hidden-details {
    border-top: 1px solid #eee;
    background: #fafafa;
  }
  .hidden-details summary {
    cursor: pointer;
    color: #444;
    padding: 0.5rem 0.85rem;
    font-size: 0.78rem;
  }
  .hidden-list {
    border-top: 1px solid #eee;
    background: white;
  }
  .hidden-item {
    opacity: 0.7;
  }
  .hidden-item:hover { opacity: 1; }
  .reason-bar {
    background: #fff5e0;
    color: #8b5a00;
    border-bottom: 1px solid #f1d9a6;
    padding: 0.15rem 0.85rem;
    font-size: 0.7rem;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.02em;
  }
</style>
