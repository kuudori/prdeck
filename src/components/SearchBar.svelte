<script>
  import { tick, onDestroy } from 'svelte';
  import { filtersStore, sortStore, annotatedPRsStore, settingsStore, setQuery } from '../lib/stores.js';
  import { autocompleteContext, suggestFields, suggestValues, applySuggestion, tokenize } from '../lib/query.js';

  export let shown = 0;
  export let total = 0;

  const SORT_OPTIONS = [
    { key: 'updated', label: 'Updated' },
    { key: 'created', label: 'Created' },
    { key: 'repo', label: 'Repo' },
    { key: 'author', label: 'Author' },
    { key: 'comments', label: 'Comments' },
    { key: 'changes', label: 'Lines changed' },
  ];

  const EXAMPLES = [
    { q: 'fix flaky', what: 'title contains both words' },
    { q: '"fix flaky"', what: 'title contains the exact phrase' },
    { q: '-wip', what: 'title does not contain "wip"' },
    { q: 'author:alice', what: 'opened by alice' },
    { q: 'repo:acme/api', what: 'in this repo (exact)' },
    { q: 'repo:~fleet', what: '~ means contains: any repo with "fleet"' },
    { q: '-author:~bot', what: 'hide every bot' },
    { q: 'label:lgtm', what: 'has the label (label:~ for contains)' },
    { q: 'review:approved', what: 'approved, changes-requested, review-required, none' },
    { q: 'ci:failure', what: 'success, failure, pending, error, none', ci: true },
    { q: 'status:new', what: 'new, updated, seen' },
    { q: 'is:draft', what: 'drafts only (-is:draft hides them)' },
    { q: 'is:watched', what: 'PRs with the bell on' },
    { q: 'updated:>2026-10-01', what: 'also created: and merged:' },
  ];

  let inputEl;
  let cursorPos = 0;
  let openSuggestions = false;
  let activeIdx = 0;
  let blurTimer;
  let helpOpen = false;
  let sortOpen = false;
  let helpEl;
  let sortEl;

  $: trackCI = $settingsStore.trackCI !== false;
  $: examples = EXAMPLES.filter((e) => trackCI || !e.ci);
  $: queryText = $filtersStore.text || '';
  $: ctx = openSuggestions ? autocompleteContext(queryText, cursorPos) : null;
  $: suggestions = (() => {
    if (!openSuggestions || !ctx) return [];
    if (ctx.kind === 'field') return suggestFields(ctx.prefix, { trackCI });
    const all = suggestValues(ctx.field, $annotatedPRsStore);
    const p = ctx.prefix.toLowerCase();
    return all.filter((v) => v.toLowerCase().includes(p)).slice(0, 30);
  })();
  $: queryErrors = tokenize(queryText).errors;
  $: sortLabel = SORT_OPTIONS.find((o) => o.key === $sortStore.key)?.label || 'Updated';

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
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => (openSuggestions = false), 120);
  }

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
      if (e.key === 'Escape' && queryText) {
        setQuery('');
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

  async function tryExample(q) {
    const base = queryText.trim();
    setQuery(base ? `${base} ${q}` : q);
    helpOpen = false;
    await tick();
    inputEl?.focus();
  }

  function setSort(key) {
    sortStore.update((s) => ({ ...s, key }));
  }
  function setDir(dir) {
    sortStore.update((s) => ({ ...s, dir }));
  }

  function closeOnOutside(e) {
    if (helpOpen && helpEl && !helpEl.contains(e.target)) helpOpen = false;
    if (sortOpen && sortEl && !sortEl.contains(e.target)) sortOpen = false;
  }
  function onWindowKey(e) {
    if (e.key !== 'Escape') return;
    helpOpen = false;
    sortOpen = false;
  }

  onDestroy(() => clearTimeout(blurTimer));
</script>

<svelte:window on:click={closeOnOutside} on:keydown={onWindowKey} />

<div class="bar">
  <div class="query" bind:this={helpEl}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#57606a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input
      type="text"
      aria-label="Search PRs"
      placeholder="Search titles, or try  repo:~fleet  -is:draft  review:approved"
      bind:this={inputEl}
      value={queryText}
      on:input={onInput}
      on:keydown={onKeydown}
      on:keyup={syncCursor}
      on:click={syncCursor}
      on:focus={onFocus}
      on:blur={onBlur} />
    {#if queryText}
      <button type="button" class="icon" aria-label="Clear search" on:click={() => { setQuery(''); inputEl?.focus(); }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    {/if}
    <button type="button" class="icon" aria-label="Search syntax help" aria-expanded={helpOpen} on:click|stopPropagation={() => { helpOpen = !helpOpen; sortOpen = false; }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5"/><path d="M12 17h.01"/></svg>
    </button>

    {#if openSuggestions && suggestions.length > 0}
      <ul class="suggest" role="listbox">
        {#if ctx?.kind === 'value'}<li class="hint-row">{ctx.field}:</li>{/if}
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

    {#if helpOpen}
      <div class="help" role="dialog" aria-label="Search syntax">
        <div class="help-head">Search syntax</div>
        {#each examples as ex}
          <button type="button" class="ex" on:click={() => tryExample(ex.q)}>
            <code>{ex.q}</code>
            <span>{ex.what}</span>
          </button>
        {/each}
        <div class="help-foot">Words are combined with AND. Put - in front of anything to exclude it. Click an example to try it.</div>
      </div>
    {/if}
  </div>

  <div class="sort" bind:this={sortEl}>
    <button type="button" class="sort-btn" aria-haspopup="menu" aria-expanded={sortOpen} on:click|stopPropagation={() => { sortOpen = !sortOpen; helpOpen = false; }}>
      <span class="muted">Sort</span> {sortLabel}
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if $sortStore.dir === 'asc'}<path d="M12 19V5M6 11l6-6 6 6"/>{:else}<path d="M12 5v14M6 13l6 6 6-6"/>{/if}
      </svg>
    </button>
    {#if sortOpen}
      <div class="menu" role="menu">
        {#each SORT_OPTIONS as o}
          <button type="button" role="menuitemradio" aria-checked={$sortStore.key === o.key} on:click={() => setSort(o.key)}>
            <span class="check">{#if $sortStore.key === o.key}✓{/if}</span>{o.label}
          </button>
        {/each}
        <div class="sep"></div>
        <button type="button" role="menuitemradio" aria-checked={$sortStore.dir === 'desc'} on:click={() => setDir('desc')}>
          <span class="check">{#if $sortStore.dir === 'desc'}✓{/if}</span>Descending
        </button>
        <button type="button" role="menuitemradio" aria-checked={$sortStore.dir === 'asc'} on:click={() => setDir('asc')}>
          <span class="check">{#if $sortStore.dir === 'asc'}✓{/if}</span>Ascending
        </button>
      </div>
    {/if}
  </div>

  <span class="count">{shown} of {total}</span>
</div>

{#if queryErrors.length > 0}
  <div class="errs">
    {#each queryErrors as e}
      <span class="err-chip">{#if e.kind === 'unknown-field'}unknown field: {e.field}{:else}{e.kind}{/if}</span>
    {/each}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid #eef0f3;
    background: #f6f8fa;
    flex-wrap: wrap;
  }
  .query {
    position: relative;
    flex: 1 1 320px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    background: #fff;
    padding: 0 4px 0 10px;
  }
  .query:focus-within { border-color: #0969da; box-shadow: 0 0 0 1px #0969da; }
  .query input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    padding: 7px 0;
    background: transparent;
  }
  button { font: inherit; cursor: pointer; }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    color: #57606a;
    border-radius: 4px;
  }
  .icon:hover { background: #f3f4f6; color: #1f2328; }
  .suggest, .help, .menu {
    position: absolute;
    top: calc(100% + 4px);
    z-index: 20;
    background: #fff;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
  }
  .suggest {
    left: 0;
    right: 0;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    max-height: 18rem;
    overflow: auto;
  }
  .suggest li {
    padding: 4px 10px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    cursor: pointer;
  }
  .suggest li.active { background: #0969da; color: #fff; }
  .suggest li.hint-row {
    color: #57606a;
    font-size: 11px;
    cursor: default;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .help {
    right: 0;
    width: min(440px, calc(100vw - 32px));
    max-height: 70vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .help-head { padding: 10px 14px; border-bottom: 1px solid #eef0f3; font-weight: 600; }
  .ex {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 10px;
    text-align: left;
    padding: 6px 14px;
    border: none;
    border-bottom: 1px solid #f3f4f6;
    background: #fff;
    font-size: 13px;
    color: #424a53;
  }
  .ex:hover { background: #f6f8fa; }
  .ex code { font-family: ui-monospace, monospace; font-size: 12px; color: #0550ae; }
  .help-foot { padding: 10px 14px; font-size: 12px; color: #57606a; background: #f6f8fa; }
  .sort { position: relative; }
  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid #d0d7de;
    background: #fff;
    border-radius: 6px;
    color: #1f2328;
    white-space: nowrap;
  }
  .sort-btn:hover { background: #f6f8fa; }
  .muted { color: #57606a; }
  .menu {
    right: 0;
    min-width: 180px;
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
    padding: 6px 12px;
    border: none;
    background: #fff;
    font-size: 13px;
    color: #1f2328;
  }
  .menu button:hover { background: #f6f8fa; }
  .check { width: 14px; color: #0969da; }
  .sep { height: 1px; background: #eef0f3; margin: 4px 0; }
  .count { font-size: 12px; color: #57606a; white-space: nowrap; }
  .errs { display: flex; gap: 4px; flex-wrap: wrap; padding: 6px 12px; border-bottom: 1px solid #eef0f3; }
  .err-chip {
    background: #fff5f5;
    color: #cf222e;
    border: 1px solid #ffcfcf;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
</style>
