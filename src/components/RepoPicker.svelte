<script>
  import { onDestroy } from 'svelte';
  import { accountStore, tokenStore } from '../lib/stores.js';
  import { knownOwners } from '../lib/account.js';
  import { searchRepos, fetchRepo } from '../lib/github.js';

  // Repos already tracked; hidden from the options.
  export let selected = [];
  export let onAdd = () => {};
  export let placeholder = 'Add a repo: name, word, or owner/name';
  export let inputId = 'repo-picker';

  let text = '';
  let open = false;
  let active = 0;
  let remote = [];
  let searching = false;
  let adding = false;
  let error = '';
  let debounce;
  let blurTimer;
  let seq = 0;

  const lc = (s) => (s || '').toLowerCase();

  $: taken = new Set(selected.map(lc));
  $: fromPRs = ($accountStore?.repos || []).filter((r) => !taken.has(lc(r.nameWithOwner)));
  $: query = text.trim();

  // Options: your PR repos that match, then name-search results, then a
  // literal owner/name if nothing else matches it exactly.
  $: options = (() => {
    const out = [];
    const seen = new Set();
    const push = (o) => {
      const k = lc(o.nameWithOwner);
      if (seen.has(k) || taken.has(k)) return;
      seen.add(k);
      out.push(o);
    };
    const q = lc(query);
    for (const r of fromPRs) if (!q || lc(r.nameWithOwner).includes(q)) push({ ...r, source: 'prs' });
    if (q) for (const r of remote) push({ ...r, source: 'search' });
    if (/^[\w.-]+\/[\w.-]+$/.test(query) && !seen.has(q) && !taken.has(q)) {
      push({ nameWithOwner: query, source: 'typed' });
    }
    return out.slice(0, q ? 12 : 8);
  })();

  $: groups = (() => {
    const map = new Map();
    for (const [i, o] of options.entries()) {
      const owner = o.source === 'typed' ? '' : o.nameWithOwner.split('/')[0];
      const key = `${owner}|${o.source === 'prs' ? 'prs' : 'other'}`;
      if (!map.has(key)) {
        const label = o.source === 'typed' ? 'Add by name' : o.source === 'prs' ? `${owner} · from your PRs` : owner;
        map.set(key, { label, items: [] });
      }
      map.get(key).items.push({ ...o, index: i });
    }
    return [...map.values()];
  })();

  function onInput() {
    open = true;
    active = 0;
    error = '';
    clearTimeout(debounce);
    const q = query;
    if (!q || q.includes('/')) {
      remote = [];
      return;
    }
    debounce = setTimeout(() => runSearch(q), 300);
  }

  async function runSearch(q) {
    const my = ++seq;
    searching = true;
    try {
      const res = await searchRepos(q, knownOwners($accountStore), $tokenStore);
      if (my === seq) remote = res;
    } catch {
      if (my === seq) remote = [];
    } finally {
      if (my === seq) searching = false;
    }
  }

  async function pick(o) {
    if (!o || adding) return;
    error = '';
    if (o.source === 'typed') {
      adding = true;
      try {
        const repo = await fetchRepo(o.nameWithOwner, $tokenStore);
        if (!repo) {
          error = `${o.nameWithOwner} doesn't exist or this token can't see it.`;
          return;
        }
        onAdd(repo.nameWithOwner);
      } catch (e) {
        error = e.message || 'Could not check that repo.';
        return;
      } finally {
        adding = false;
      }
    } else {
      onAdd(o.nameWithOwner);
    }
    text = '';
    remote = [];
    active = 0;
  }

  function onKeydown(e) {
    if (e.key === 'ArrowDown') {
      open = true;
      active = Math.min(active + 1, options.length - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && options[active]) pick(options[active]);
    } else if (e.key === 'Escape' && open) {
      open = false;
      e.stopPropagation();
    }
  }

  function onBlur() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => (open = false), 150);
  }

  onDestroy(() => {
    clearTimeout(debounce);
    clearTimeout(blurTimer);
  });
</script>

<div class="picker">
  <div class="field" class:focus={open}>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#57606a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    <input
      id={inputId}
      type="text"
      role="combobox"
      aria-expanded={open && options.length > 0}
      aria-controls="{inputId}-list"
      aria-autocomplete="list"
      aria-activedescendant={open && options[active] ? `${inputId}-opt-${active}` : undefined}
      aria-label="Add a repository"
      {placeholder}
      bind:value={text}
      disabled={adding}
      on:input={onInput}
      on:focus={() => (open = true)}
      on:blur={onBlur}
      on:keydown={onKeydown} />
    {#if searching || adding}<span class="spin" aria-hidden="true"></span>{/if}
  </div>

  {#if open && options.length > 0}
    <div class="list" id="{inputId}-list" role="listbox">
      {#each groups as g}
        <div class="group">{g.label}</div>
        {#each g.items as o (o.nameWithOwner + o.source)}
          <div
            id="{inputId}-opt-{o.index}"
            class="opt"
            class:active={o.index === active}
            role="option"
            tabindex="-1"
            aria-selected={o.index === active}
            on:mousedown|preventDefault={() => pick(o)}
            on:mouseenter={() => (active = o.index)}>
            <span class="name">{o.nameWithOwner}</span>
            {#if o.isPrivate}<span class="meta">private</span>{/if}
            {#if o.source === 'prs'}<span class="meta">{o.prs} of your PRs</span>{/if}
          </div>
        {/each}
      {/each}
    </div>
  {:else if open && query && !searching}
    <div class="list empty">No repos match "{query}" in your orgs. Type owner/name to add any repo.</div>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
  .picker { position: relative; display: flex; flex-direction: column; }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 0 10px;
    background: #fff;
  }
  .field.focus { border-color: #0969da; box-shadow: 0 0 0 1px #0969da; }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    font: inherit;
    font-size: 13px;
    padding: 7px 0;
    background: transparent;
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 5;
    max-height: 300px;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
    font-size: 13px;
  }
  .list.empty { padding: 10px; color: #57606a; }
  .group {
    padding: 7px 10px 3px;
    font-size: 11px;
    font-weight: 600;
    color: #57606a;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .group:not(:first-child) { border-top: 1px solid #eef0f3; }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .opt.active { background: #0969da; color: #fff; }
  .opt.active .meta { color: #ddf4ff; }
  .name { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  .meta { margin-left: auto; font-size: 11px; color: #57606a; white-space: nowrap; }
  .err { margin: 6px 0 0; color: #cf222e; font-size: 12px; }
  .spin {
    width: 12px;
    height: 12px;
    border: 2px solid #d0d7de;
    border-top-color: #0969da;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
