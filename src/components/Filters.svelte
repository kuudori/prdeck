<script>
  import { tick, onDestroy } from 'svelte';
  import { filtersStore, sortStore, annotatedPRsStore, resetFilters, settingsStore } from '../lib/stores.js';
  import {
    autocompleteContext,
    suggestFields,
    suggestValues,
    applySuggestion,
    tokenize,
  } from '../lib/query.js';

  const SORT_OPTIONS = [
    { key: 'updated', label: 'updated' },
    { key: 'created', label: 'created' },
    { key: 'repo', label: 'repo' },
    { key: 'author', label: 'author' },
    { key: 'comments', label: 'comments' },
    { key: 'changes', label: 'lines' },
  ];

  function setSortKey(k) {
    sortStore.update((s) => ({ ...s, key: k }));
  }
  function toggleSortDir() {
    sortStore.update((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }));
  }

  function clearRepoExclude(r) {
    filtersStore.update((f) => ({ ...f, repoExclude: f.repoExclude.filter((x) => x !== r) }));
  }
  function clearAuthorExclude(a) {
    filtersStore.update((f) => ({ ...f, authorsExclude: (f.authorsExclude || []).filter((x) => x !== a) }));
  }

  let inputEl;
  let cursorPos = 0;
  let openSuggestions = false;
  let activeIdx = 0;
  let blurTimer;

  $: queryText = $filtersStore.text || '';
  $: ctx = openSuggestions ? autocompleteContext(queryText, cursorPos) : null;
  $: suggestions = (() => {
    if (!openSuggestions || !ctx) return [];
    if (ctx.kind === 'field') return suggestFields(ctx.prefix, { trackCI: $settingsStore.trackCI !== false });
    const all = suggestValues(ctx.field, $annotatedPRsStore);
    const p = ctx.prefix.toLowerCase();
    return all.filter((v) => v.toLowerCase().includes(p)).slice(0, 30);
  })();
  $: queryErrors = tokenize(queryText).errors;

  function setQuery(text) {
    filtersStore.update((f) => ({ ...f, text }));
  }

  function syncCursor() {
    if (inputEl) cursorPos = inputEl.selectionStart ?? queryText.length;
  }

  function onInput(e) {
    setQuery(e.target.value);
    syncCursor();
    openSuggestions = true;
    activeIdx = 0;
  }
  function onFocus() {
    syncCursor();
    openSuggestions = true;
    activeIdx = 0;
  }
  function onBlur() {
    // delay so click on a suggestion can register
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { openSuggestions = false; }, 120);
  }

  onDestroy(() => clearTimeout(blurTimer));

  async function pickSuggestion(s) {
    if (!ctx) return;
    const { text, cursor } = applySuggestion(queryText, ctx, s);
    setQuery(text);
    await tick();
    if (inputEl) {
      inputEl.focus();
      inputEl.setSelectionRange(cursor, cursor);
      cursorPos = cursor;
    }
    openSuggestions = true;
    activeIdx = 0;
  }

  function onKeydown(e) {
    if (!openSuggestions || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && !openSuggestions) {
        openSuggestions = true;
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      activeIdx = (activeIdx + 1) % suggestions.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIdx = (activeIdx - 1 + suggestions.length) % suggestions.length;
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      openSuggestions = false;
      e.preventDefault();
    }
  }
</script>

<section class="filters">
  <div class="row search-row">
    <div class="query-wrap">
      <input
        type="text"
        class="search"
        placeholder='fix flaky repo:~hyperfleet -is:draft review:approved'
        bind:this={inputEl}
        value={queryText}
        on:input={onInput}
        on:keydown={onKeydown}
        on:keyup={syncCursor}
        on:click={syncCursor}
        on:focus={onFocus}
        on:blur={onBlur} />
      {#if openSuggestions && suggestions.length > 0}
        <ul class="suggest" role="listbox">
          {#if ctx?.kind === 'value'}
            <li class="hint-row">{ctx.field}:</li>
          {/if}
          {#each suggestions as s, i (s)}
            <li
              class:active={i === activeIdx}
              role="option"
              aria-selected={i === activeIdx}
              on:mousedown|preventDefault={() => pickSuggestion(s)}
              on:mouseenter={() => (activeIdx = i)}>
              {s}{ctx?.kind === 'field' ? ':' : ''}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button type="button" on:click={resetFilters}>Reset</button>
  </div>

  {#if queryErrors.length > 0}
    <div class="errs">
      {#each queryErrors as e}
        <span class="err-chip">
          {#if e.kind === 'unknown-field'}unknown field: {e.field}
          {:else}{e.kind}{/if}
        </span>
      {/each}
    </div>
  {/if}

  <div class="row group">
    <span class="label">Sort</span>
    {#each SORT_OPTIONS as s}
      <button type="button" class:active={$sortStore.key === s.key} on:click={() => setSortKey(s.key)}>{s.label}</button>
    {/each}
    <button type="button" class="dir" on:click={toggleSortDir} title="toggle direction" aria-label="toggle sort direction">
      {#if $sortStore.dir === 'asc'}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      {/if}
    </button>
  </div>

  {#if $filtersStore.repoExclude.length || ($filtersStore.authorsExclude || []).length}
    <details open>
      <summary>Excluded ({$filtersStore.repoExclude.length + ($filtersStore.authorsExclude || []).length})</summary>
      <div class="chips">
        {#each $filtersStore.repoExclude as r}
          <button type="button" class="excluded" on:click={() => clearRepoExclude(r)} title="click to remove">repo: {r} ×</button>
        {/each}
        {#each ($filtersStore.authorsExclude || []) as a}
          <button type="button" class="excluded" on:click={() => clearAuthorExclude(a)} title="click to remove">@{a} ×</button>
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
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .row.group .label {
    font-size: 0.75rem;
    color: #666;
    min-width: 5rem;
  }
  input[type="text"] {
    flex: 1;
    min-width: 12rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: inherit;
  }
  .query-wrap {
    position: relative;
    flex: 1;
    min-width: 12rem;
    display: flex;
  }
  .query-wrap input {
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
  .suggest {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0.2rem 0;
    list-style: none;
    background: white;
    border: 1px solid #d0d7de;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    max-height: 18rem;
    overflow: auto;
    z-index: 50;
  }
  .suggest li {
    padding: 0.22rem 0.6rem;
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
    cursor: pointer;
    color: #1f2328;
  }
  .suggest li.active {
    background: #0969da;
    color: white;
  }
  .suggest li.hint-row {
    color: #888;
    font-size: 0.7rem;
    cursor: default;
    padding-bottom: 0.1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .errs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .err-chip {
    background: #fff5f5;
    color: #cf222e;
    border: 1px solid #ffcfcf;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
  }
  button {
    padding: 0.2rem 0.55rem;
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
  button.dir {
    border-radius: 4px;
    padding: 0.2rem 0.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding-top: 0.4rem;
  }
  details > summary {
    cursor: pointer;
    font-size: 0.8rem;
    color: #444;
  }
</style>
