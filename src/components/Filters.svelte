<script>
  import { filtersStore, annotatedPRsStore } from '../lib/stores.js';

  const CI_STATES = ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'EXPECTED', 'NONE'];
  const REVIEW_DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'NONE'];
  const STATUSES = ['NEW', 'UPDATED', 'SEEN'];

  $: repos = [...new Set($annotatedPRsStore.map((p) => p.repo))].sort();
  $: authors = [...new Set($annotatedPRsStore.map((p) => p.author))].sort();

  function toggle(arr, value) {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  function toggleStatus(s) {
    filtersStore.update((f) => ({ ...f, statuses: toggle(f.statuses, s) }));
  }
  function toggleCi(s) {
    filtersStore.update((f) => ({ ...f, ciStates: toggle(f.ciStates, s) }));
  }
  function toggleReview(s) {
    filtersStore.update((f) => ({ ...f, reviewDecisions: toggle(f.reviewDecisions, s) }));
  }
  function toggleRepoInclude(r) {
    filtersStore.update((f) => ({ ...f, repoInclude: toggle(f.repoInclude, r) }));
  }
  function toggleRepoExclude(r) {
    filtersStore.update((f) => ({ ...f, repoExclude: toggle(f.repoExclude, r) }));
  }
  function toggleAuthor(a) {
    filtersStore.update((f) => ({ ...f, authors: toggle(f.authors, a) }));
  }
  function setDraft(v) {
    filtersStore.update((f) => ({ ...f, draft: v }));
  }
  function reset() {
    filtersStore.set({
      repoInclude: [],
      repoExclude: [],
      authors: [],
      ciStates: [],
      reviewDecisions: [],
      statuses: [],
      draft: 'all',
      text: '',
    });
  }
</script>

<section class="filters">
  <div class="row">
    <input type="text" placeholder="Search title…" bind:value={$filtersStore.text} />
    <button type="button" on:click={reset}>Reset filters</button>
  </div>

  <div class="row group">
    <span class="label">Status</span>
    {#each STATUSES as s}
      <button
        type="button"
        class:active={$filtersStore.statuses.includes(s)}
        on:click={() => toggleStatus(s)}>{s}</button>
    {/each}
  </div>

  <div class="row group">
    <span class="label">CI</span>
    {#each CI_STATES as s}
      <button
        type="button"
        class:active={$filtersStore.ciStates.includes(s)}
        on:click={() => toggleCi(s)}>{s}</button>
    {/each}
  </div>

  <div class="row group">
    <span class="label">Review</span>
    {#each REVIEW_DECISIONS as s}
      <button
        type="button"
        class:active={$filtersStore.reviewDecisions.includes(s)}
        on:click={() => toggleReview(s)}>{s.replace('_', ' ')}</button>
    {/each}
  </div>

  <div class="row group">
    <span class="label">Draft</span>
    {#each ['all', 'only', 'exclude'] as v}
      <button
        type="button"
        class:active={$filtersStore.draft === v}
        on:click={() => setDraft(v)}>{v}</button>
    {/each}
  </div>

  {#if repos.length > 0}
    <details>
      <summary>Repos ({repos.length})</summary>
      <div class="chips">
        {#each repos as r}
          <button
            type="button"
            class:active={$filtersStore.repoInclude.includes(r)}
            class:excluded={$filtersStore.repoExclude.includes(r)}
            on:click={() => toggleRepoInclude(r)}
            on:contextmenu|preventDefault={() => toggleRepoExclude(r)}
            title="Click: include. Right-click: exclude.">{r}</button>
        {/each}
      </div>
    </details>
  {/if}

  {#if authors.length > 0}
    <details>
      <summary>Authors ({authors.length})</summary>
      <div class="chips">
        {#each authors as a}
          <button
            type="button"
            class:active={$filtersStore.authors.includes(a)}
            on:click={() => toggleAuthor(a)}>{a}</button>
        {/each}
      </div>
    </details>
  {/if}
</section>

<style>
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fafafa;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .row.group .label {
    font-size: 0.8rem;
    color: #666;
    min-width: 4rem;
  }
  input[type="text"] {
    flex: 1;
    min-width: 12rem;
    padding: 0.4rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: inherit;
  }
  button {
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    border: 1px solid #ccc;
    background: white;
    border-radius: 999px;
    cursor: pointer;
  }
  button.active {
    background: #0969da;
    color: white;
    border-color: #0969da;
  }
  button.excluded {
    background: #ffe0e0;
    border-color: #b00020;
    color: #b00020;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding-top: 0.5rem;
  }
  details > summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: #444;
  }
</style>
