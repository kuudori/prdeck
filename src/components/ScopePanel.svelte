<script>
  import { onMount } from 'svelte';
  import Drawer from './Drawer.svelte';
  import RepoPicker from './RepoPicker.svelte';
  import { settingsStore, tokenStore, accountStore } from '../lib/stores.js';
  import { ensureAccount } from '../lib/account.js';
  import { fetchOwner, countOpenPRs } from '../lib/github.js';

  export let onClose = () => {};
  export let onChange = () => {};

  // Above this, an org scope gets slow and nears the 1,000-result cap.
  const BUSY = 500;
  const WINDOWS = [
    { days: 30, label: 'last 30 days' },
    { days: 90, label: 'last 90 days' },
    { days: 365, label: 'last year' },
    { days: 0, label: 'any time' },
  ];

  let counts = {};
  let addingOrg = false;
  let orgText = '';
  let orgBusy = false;
  let orgError = '';

  $: s = $settingsStore;
  $: repos = s.watchRepos || [];
  $: wholeOwners = [
    ...(s.watchOrgs || []).map((login) => ({ login, kind: 'org' })),
    ...(s.watchUsers || []).map((login) => ({ login, kind: 'user' })),
  ];
  $: orgSuggestions = ($accountStore?.orgs || []).filter(
    (o) => !wholeOwners.some((w) => w.login.toLowerCase() === o.login.toLowerCase())
  );
  $: windows = WINDOWS.some((w) => w.days === s.openCreatedDays)
    ? WINDOWS
    : [...WINDOWS, { days: s.openCreatedDays, label: `last ${s.openCreatedDays} days` }];
  $: for (const o of wholeOwners) loadCount(o);

  function update(patch) {
    settingsStore.update((cur) => ({ ...cur, ...patch }));
    onChange();
  }

  function removeRepo(name) {
    update({ watchRepos: repos.filter((r) => r !== name) });
  }
  function addRepo(name) {
    update({ watchRepos: [...new Set([...repos, name])] });
  }
  function removeOwner(o) {
    if (o.kind === 'org') update({ watchOrgs: (s.watchOrgs || []).filter((x) => x !== o.login) });
    else update({ watchUsers: (s.watchUsers || []).filter((x) => x !== o.login) });
  }

  async function loadCount(o) {
    const key = `${o.kind}:${o.login}`;
    if (key in counts) return;
    counts = { ...counts, [key]: undefined };
    try {
      const n = await countOpenPRs(o.login, o.kind, $tokenStore);
      counts = { ...counts, [key]: n };
    } catch {
      counts = { ...counts, [key]: null };
    }
  }

  async function addOwner(name) {
    const login = (name || '').trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\/.*$/, '');
    if (!login || orgBusy) return;
    orgBusy = true;
    orgError = '';
    try {
      const owner = await fetchOwner(login, $tokenStore);
      if (!owner) {
        orgError = `No org or user named "${login}".`;
        return;
      }
      if (owner.kind === 'org') update({ watchOrgs: [...new Set([...(s.watchOrgs || []), owner.login])] });
      else update({ watchUsers: [...new Set([...(s.watchUsers || []), owner.login])] });
      orgText = '';
      addingOrg = false;
    } catch (e) {
      orgError = e.message || 'Lookup failed.';
    } finally {
      orgBusy = false;
    }
  }

  function countLabel(o) {
    const n = counts[`${o.kind}:${o.login}`];
    if (n === undefined) return 'counting…';
    if (n === null) return '';
    return `${n.toLocaleString()} open PR${n === 1 ? '' : 's'}`;
  }

  $: busy = wholeOwners.some((o) => (counts[`${o.kind}:${o.login}`] || 0) > BUSY);

  onMount(() => {
    ensureAccount($tokenStore).catch(() => {});
  });
</script>

<Drawer title="What prdeck tracks" {onClose}>
  <div class="content">
    <label class="involves">
      <input type="checkbox" checked={s.includeInvolves} on:change={(e) => update({ includeInvolves: e.currentTarget.checked })} />
      <span>
        <span class="strong">PRs involving you</span>
        <span class="desc">Opened by you, reviewed by you, assigned to you or mentioning you, in any repo.</span>
      </span>
    </label>

    <section>
      <div class="title"><h3>Repositories</h3><span class="muted">every open PR in each</span></div>
      {#if repos.length > 0}
        <ul class="items">
          {#each repos as r (r)}
            <li>
              <span class="mono">{r}</span>
              <button type="button" class="remove" aria-label="Stop tracking {r}" on:click={() => removeRepo(r)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <RepoPicker selected={repos} onAdd={addRepo} inputId="scope-repo" />
    </section>

    <section>
      <div class="title"><h3>Whole organizations</h3><span class="muted">every open PR in every repo</span></div>
      {#if wholeOwners.length > 0}
        <ul class="items">
          {#each wholeOwners as o (o.kind + o.login)}
            <li>
              <span class="mono">{o.login}</span>
              {#if o.kind === 'user'}<span class="tag">user</span>{/if}
              <span class="muted small">{countLabel(o)}</span>
              <button type="button" class="remove" aria-label="Stop tracking all of {o.login}" on:click={() => removeOwner(o)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if wholeOwners.length > 0 || addingOrg}
        <div class="warn" class:strong-warn={busy}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/></svg>
          <span>Busy orgs get slow and stop at GitHub's 1,000-result limit. Usually you want specific repos, or just "PRs involving you".</span>
        </div>
      {/if}
      {#if addingOrg}
        <form class="add-org" on:submit|preventDefault={() => addOwner(orgText)}>
          <input type="text" aria-label="Organization name" placeholder="Org name, e.g. acme" bind:value={orgText} disabled={orgBusy} />
          <button type="submit" disabled={orgBusy || !orgText.trim()}>{orgBusy ? 'Checking…' : 'Track'}</button>
          <button type="button" class="plain" on:click={() => { addingOrg = false; orgError = ''; }}>Cancel</button>
        </form>
        {#if orgSuggestions.length > 0}
          <div class="chips">
            {#each orgSuggestions as o (o.login)}
              <button type="button" class="chip" on:click={() => addOwner(o.login)}>{o.login}</button>
            {/each}
          </div>
        {/if}
        {#if orgError}<p class="err" role="alert">{orgError}</p>{/if}
      {:else}
        <button type="button" class="secondary" on:click={() => (addingOrg = true)}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Track a whole org
        </button>
      {/if}
    </section>

    <section>
      <h3>How far back</h3>
      <label class="row">
        <span>Open PRs created in the</span>
        <select value={s.openCreatedDays} on:change={(e) => update({ openCreatedDays: Number(e.currentTarget.value) })}>
          {#each windows as w}<option value={w.days}>{w.label}</option>{/each}
        </select>
      </label>
      <span class="muted small">The merged window sits on the Merged tab, next to what it changes.</span>
    </section>
  </div>

  <svelte:fragment slot="footer">
    <span style="flex: 1">Changes apply right away with a full resync.</span>
    <button type="button" class="secondary" on:click={onClose}>Done</button>
  </svelte:fragment>
</Drawer>

<style>
  .content { display: flex; flex-direction: column; gap: 22px; padding: 18px 20px; }
  section { display: flex; flex-direction: column; gap: 8px; }
  .title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  h3 { margin: 0; font-size: 14px; font-weight: 600; }
  .muted { color: #57606a; font-size: 12px; }
  .small { font-size: 12px; }
  .strong { font-weight: 600; }
  .desc { font-size: 13px; color: #424a53; }
  .mono { font-family: ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }
  .involves {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px;
    border: 1px solid #54aeff;
    background: #ddf4ff;
    border-radius: 6px;
    cursor: pointer;
  }
  .involves input { margin-top: 3px; }
  .involves > span { display: flex; flex-direction: column; gap: 2px; }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    overflow: hidden;
  }
  .items li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 10px;
    border-bottom: 1px solid #eef0f3;
  }
  .items li:last-child { border-bottom: none; }
  .tag {
    font-size: 11px;
    color: #57606a;
    border: 1px solid #d0d7de;
    border-radius: 999px;
    padding: 0 6px;
  }
  .remove {
    margin-left: auto;
    display: inline-flex;
    padding: 5px;
    border: none;
    background: none;
    color: #57606a;
    border-radius: 6px;
    cursor: pointer;
  }
  .remove:hover { background: #ffebe9; color: #cf222e; }
  .warn {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 10px;
    border: 1px solid #d8dee4;
    background: #f6f8fa;
    border-radius: 6px;
    font-size: 12px;
    color: #424a53;
  }
  .warn svg { flex-shrink: 0; margin-top: 1px; }
  .warn.strong-warn { border-color: #d4a72c; background: #fff8c5; color: #4d2d00; }
  .add-org { display: flex; gap: 6px; }
  .add-org input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font: inherit;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    padding: 3px 9px;
    border: 1px solid #d0d7de;
    background: #fff;
    border-radius: 999px;
    cursor: pointer;
  }
  .chip:hover { border-color: #0969da; color: #0969da; }
  button.secondary, .add-org button {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: 13px;
    padding: 5px 12px;
    border: 1px solid #d0d7de;
    background: #f6f8fa;
    border-radius: 6px;
    color: #1f2328;
    cursor: pointer;
  }
  button.secondary:hover, .add-org button:hover { background: #eef1f4; }
  .add-org button:disabled { opacity: 0.55; cursor: not-allowed; }
  .add-org button.plain { background: none; border-color: transparent; color: #57606a; }
  .row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .row span { flex: 1; }
  select {
    font: inherit;
    font-size: 13px;
    padding: 5px 8px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    background: #f6f8fa;
  }
  .err { margin: 0; color: #cf222e; font-size: 12px; }
</style>
