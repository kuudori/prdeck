<script>
  import { onMount } from 'svelte';
  import {
    settingsStore,
    tokenStore,
    userLoginStore,
    ownersCacheStore,
    reposCacheStore,
    sidebarCollapsedStore,
  } from '../lib/stores.js';
  import { setMeta, clearAll } from '../lib/cache.js';
  import { fetchViewerAndOrgs, fetchOwnerRepos } from '../lib/github.js';
  import { notificationsSupported } from '../lib/watch.js';

  export let onScopeChange = () => {};

  let local = JSON.parse(JSON.stringify($settingsStore));
  if (!Array.isArray(local.watchUsers)) local.watchUsers = [];

  let token = $tokenStore;
  let editingToken = !token;

  let ownersLoading = false;
  let ownersError = '';

  // map of login -> { loading, error }
  let repoFetchState = {};

  let repoFilterText = '';

  function toggleCollapse(key) {
    sidebarCollapsedStore.update((c) => ({ ...c, [key]: !c[key] }));
  }

  $: viewerUser = $ownersCacheStore?.user || null;
  $: viewerOrgs = $ownersCacheStore?.orgs || [];

  $: selectedUserLogins = local.watchUsers || [];
  $: selectedOrgLogins = local.watchOrgs || [];
  $: selectedRepos = local.watchRepos || [];
  $: hasAnyOwner = selectedUserLogins.length + selectedOrgLogins.length > 0;

  // Active owner logins (regardless of user/org kind)
  $: activeOwnerLogins = [...selectedUserLogins, ...selectedOrgLogins];

  // Combined repo list from cache for currently-selected owners
  $: ownerRepoOptions = (() => {
    const out = [];
    const cache = $reposCacheStore || {};
    for (const login of activeOwnerLogins) {
      const entry = cache[login];
      if (entry?.repos) {
        for (const r of entry.repos) out.push(r);
      }
    }
    return out;
  })();

  $: filteredRepoOptions = (() => {
    const q = repoFilterText.trim().toLowerCase();
    const list = ownerRepoOptions;
    if (!q) return list;
    return list.filter((r) => r.nameWithOwner.toLowerCase().includes(q));
  })();

  function intOr(v, min, fallback) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && v !== '' && v != null ? Math.max(min, n) : fallback;
  }

  function commit() {
    local.intervalMinutes = intOr(local.intervalMinutes, 1, 5);
    local.mergedDays = intOr(local.mergedDays, 1, 7);
    local.openCreatedDays = intOr(local.openCreatedDays, 0, 90);
    local.pauseAfterHours = intOr(local.pauseAfterHours, 0, 2);
    settingsStore.set({ ...local });
    onScopeChange();
  }

  async function saveToken() {
    const t = (token || '').trim();
    tokenStore.set(t);
    editingToken = false;
    if (t) await loadOwners(t);
  }
  async function loadOwners(t) {
    const tok = (t || $tokenStore || '').trim();
    if (!tok) return;
    ownersLoading = true;
    ownersError = '';
    try {
      const { user, orgs } = await fetchViewerAndOrgs(tok);
      ownersCacheStore.set({ user, orgs, fetchedAt: Date.now() });
      if (user) {
        userLoginStore.set(user.login);
        try { await setMeta('userLogin', user.login); } catch {}
      }
    } catch (e) {
      ownersError = e.message || 'Failed to load orgs.';
    } finally {
      ownersLoading = false;
    }
  }

  async function loadReposFor(login) {
    const t = ($tokenStore || token || '').trim();
    if (!t) return;
    repoFetchState = { ...repoFetchState, [login]: { loading: true, error: '' } };
    try {
      const repos = await fetchOwnerRepos(login, t);
      reposCacheStore.update((c) => ({
        ...(c || {}),
        [login]: { repos, fetchedAt: Date.now() },
      }));
      repoFetchState = { ...repoFetchState, [login]: { loading: false, error: '' } };
    } catch (e) {
      repoFetchState = { ...repoFetchState, [login]: { loading: false, error: e.message || 'fetch failed' } };
    }
  }

  function ensureReposFor(login) {
    const cache = $reposCacheStore || {};
    if (!cache[login] && !repoFetchState[login]?.loading) loadReposFor(login);
  }

  function toggleUser(login) {
    const on = selectedUserLogins.includes(login);
    local.watchUsers = on
      ? selectedUserLogins.filter((x) => x !== login)
      : [...selectedUserLogins, login];
    if (!on) ensureReposFor(login);
    commit();
  }
  function toggleOrg(login) {
    const on = selectedOrgLogins.includes(login);
    local.watchOrgs = on
      ? selectedOrgLogins.filter((x) => x !== login)
      : [...selectedOrgLogins, login];
    if (!on) ensureReposFor(login);
    commit();
  }
  function toggleWatchRepo(name) {
    local.watchRepos = selectedRepos.includes(name)
      ? selectedRepos.filter((x) => x !== name)
      : [...selectedRepos, name];
    commit();
  }
  function reloadOwnersClick() { loadOwners(); }
  function reloadOwnerRepos(login) { loadReposFor(login); }

  const NOTIF_LABEL = { granted: 'allowed', denied: 'blocked', default: 'not asked' };
  let notifPermission = notificationsSupported() ? Notification.permission : 'unsupported';

  async function enableNotifications() {
    try { notifPermission = await Notification.requestPermission(); } catch {}
  }
  function testNotification() {
    new Notification('prdeck', { body: 'Notifications work. Belled PRs will show up like this.' });
  }

  async function clearCache() {
    if (!confirm('Clear cached PRs, viewed history, and observed records?')) return;
    await clearAll();
    location.reload();
  }

  onMount(() => {
    // First load: if we have a token but no cached owners, fetch them.
    if ($tokenStore && !$ownersCacheStore) loadOwners();
    // For any owner already selected, make sure we have a repo list to show.
    for (const login of [...selectedUserLogins, ...selectedOrgLogins]) {
      ensureReposFor(login);
    }
  });
</script>

<aside class="sidebar">
  <!-- Step 1: token -->
  <section class="step">
    <button type="button" class="step-header" on:click={() => toggleCollapse('token')} aria-expanded={!$sidebarCollapsedStore.token}>
      <svg class="chevron" class:open={!$sidebarCollapsedStore.token} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      <span class="num">1</span>
      <span class="step-title">Token</span>
    </button>
    {#if !$sidebarCollapsedStore.token}
      {#if editingToken}
        <input
          type="password"
          placeholder="ghp_… or github_pat_…"
          bind:value={token}
          autocomplete="off"
          on:keydown={(e) => { if (e.key === 'Enter') saveToken(); }} />
        <div class="row">
          <button type="button" class="primary" on:click={saveToken} disabled={!(token || '').trim()}>Save</button>
          <small class="hint">repo:read · pull-requests:read</small>
        </div>
      {:else}
        <div class="row token-set">
          <span class="ok">✓ token saved</span>
          <button type="button" class="link" on:click={() => (editingToken = true)}>edit</button>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Step 2: owners -->
  <section class="step" class:disabled={!$tokenStore}>
    <div class="step-row">
      <button type="button" class="step-header" on:click={() => toggleCollapse('owners')} aria-expanded={!$sidebarCollapsedStore.owners}>
        <svg class="chevron" class:open={!$sidebarCollapsedStore.owners} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="num">2</span>
        <span class="step-title">Owners</span>
      </button>
      {#if $ownersCacheStore && !$sidebarCollapsedStore.owners}
        <button type="button" class="link tiny" on:click={reloadOwnersClick} title="reload list">{#if ownersLoading}<span class="rainbow">updating…</span>{:else}↻{/if}</button>
      {/if}
    </div>
    {#if !$sidebarCollapsedStore.owners}
      {#if !$tokenStore}
        <small class="hint">Save a token first.</small>
      {:else if ownersLoading && !$ownersCacheStore}
        <small class="hint">Loading…</small>
      {:else if !$ownersCacheStore}
        <small class="hint">Loading account…</small>
      {:else}
        <ul class="owners">
          {#if viewerUser}
            <li>
              <label class:on={selectedUserLogins.includes(viewerUser.login)}>
                <input type="checkbox" checked={selectedUserLogins.includes(viewerUser.login)} on:change={() => toggleUser(viewerUser.login)} />
                <span class="login">{viewerUser.login}</span>
                <span class="kind">personal</span>
              </label>
            </li>
          {/if}
          {#each viewerOrgs as o}
            <li>
              <label class:on={selectedOrgLogins.includes(o.login)}>
                <input type="checkbox" checked={selectedOrgLogins.includes(o.login)} on:change={() => toggleOrg(o.login)} />
                <span class="login">{o.login}</span>
                <span class="kind">org</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
      {#if ownersError}<small class="err">{ownersError}</small>{/if}
    {/if}
  </section>

  <!-- Step 3: repos -->
  <section class="step" class:disabled={!hasAnyOwner}>
    <div class="step-row">
      <button type="button" class="step-header" on:click={() => toggleCollapse('repos')} aria-expanded={!$sidebarCollapsedStore.repos}>
        <svg class="chevron" class:open={!$sidebarCollapsedStore.repos} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="num">3</span>
        <span class="step-title">Repos</span>
      </button>
      {#if hasAnyOwner && !$sidebarCollapsedStore.repos}
        <button type="button" class="link tiny" title="reload"
          on:click={() => activeOwnerLogins.forEach(reloadOwnerRepos)}>↻</button>
      {/if}
    </div>
    {#if !$sidebarCollapsedStore.repos}
      {#if !hasAnyOwner}
        <small class="hint">Pick an owner first.</small>
      {:else}
        <input type="text" placeholder="Filter repos…" bind:value={repoFilterText} />
        {#each activeOwnerLogins as login}
          {#if repoFetchState[login]?.loading}
            <small class="hint">Fetching {login}…</small>
          {/if}
          {#if repoFetchState[login]?.error}
            <small class="err">{login}: {repoFetchState[login].error}</small>
          {/if}
        {/each}

        {#if filteredRepoOptions.length > 0}
          <ul class="results">
            {#each filteredRepoOptions as r (r.nameWithOwner)}
              <li>
                <label class:on={selectedRepos.includes(r.nameWithOwner)}>
                  <input
                    type="checkbox"
                    checked={selectedRepos.includes(r.nameWithOwner)}
                    on:change={() => toggleWatchRepo(r.nameWithOwner)} />
                  <span class="login">{r.nameWithOwner}</span>
                  {#if r.isPrivate}<span class="kind">private</span>{/if}
                </label>
              </li>
            {/each}
          </ul>
        {:else if ownerRepoOptions.length === 0}
          <small class="hint">Loading repositories…</small>
        {:else}
          <small class="hint">No repos match "{repoFilterText}".</small>
        {/if}

        <label class="watch-all">
          <input type="checkbox" bind:checked={local.includeInvolves} on:change={commit} />
          Also: PRs involving me
        </label>

        {#if selectedRepos.length > 0}
          <div class="watching">
            <small class="hint">Watching {selectedRepos.length}:</small>
            <ul class="chips">
              {#each selectedRepos as r}
                <li><button type="button" class="chip" on:click={() => toggleWatchRepo(r)} title="click to remove">{r} ×</button></li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    {/if}
  </section>

  <!-- Advanced -->
  <section class="step">
    <button type="button" class="step-header" on:click={() => toggleCollapse('advanced')} aria-expanded={!$sidebarCollapsedStore.advanced}>
      <svg class="chevron" class:open={!$sidebarCollapsedStore.advanced} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      <span class="step-title">Advanced</span>
    </button>
    {#if !$sidebarCollapsedStore.advanced}
      <label class="adv">
        <span>Refresh interval (min)</span>
        <input type="number" min="1" bind:value={local.intervalMinutes} on:change={commit} />
      </label>
      <label class="adv-check">
        <input type="checkbox" bind:checked={local.trackCI} on:change={commit} />
        Track CI status
      </label>
      <label class="adv">
        <span>Pause refresh after tab hidden for (h, 0 = never)</span>
        <input type="number" min="0" bind:value={local.pauseAfterHours} on:change={commit} />
      </label>
      <label class="adv">
        <span>Open PRs created in last (days, 0 = all)</span>
        <input type="number" min="0" bind:value={local.openCreatedDays} on:change={commit} />
      </label>
      <label class="adv">
        <span>Merged PRs from last (days)</span>
        <input type="number" min="1" bind:value={local.mergedDays} on:change={commit} />
      </label>
      <div class="adv-note">
        <span>Bell notifications: {NOTIF_LABEL[notifPermission] || 'not supported'}</span>
        {#if notifPermission === 'default'}
          <button type="button" class="link" on:click={enableNotifications}>enable</button>
        {:else if notifPermission === 'granted'}
          <button type="button" class="link" on:click={testNotification}>test</button>
        {:else if notifPermission === 'denied'}
          <small class="hint">allow in the browser's site settings; the tab title still shows (n)</small>
        {/if}
      </div>
      <button type="button" class="danger" on:click={clearCache}>Clear cache</button>
    {/if}
  </section>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    background: #fafafa;
    border-right: 1px solid #e0e0e0;
    min-height: 100%;
    box-sizing: border-box;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid #ececec;
  }
  .step:last-child { border-bottom: none; }
  .step.disabled { opacity: 0.55; }
  .step-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .step-row > .step-header { flex: 1; }
  .step-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0.1rem 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #555;
  }
  .step-header:hover .step-title { color: #1f2328; }
  .step-title { flex: 1; }
  .chevron {
    transition: transform 120ms ease;
    color: #777;
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(90deg); }
  .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    background: #0969da;
    color: white;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  input[type="text"],
  input[type="password"],
  input[type="number"] {
    font: inherit;
    padding: 0.32rem 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    width: 100%;
    box-sizing: border-box;
  }
  .hint { color: #888; font-size: 0.72rem; }
  .err { color: #b00020; font-size: 0.72rem; }
  .ok { color: #1a7f37; font-size: 0.78rem; font-weight: 600; }
  .token-set { display: flex; align-items: center; gap: 0.4rem; }

  button {
    padding: 0.32rem 0.6rem;
    border: 1px solid #ccc;
    background: white;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: #0969da; color: white; border-color: #0969da; }
  button.link {
    background: none;
    border: none;
    padding: 0;
    color: #0969da;
    text-decoration: underline;
    font-size: 0.72rem;
  }
  button.link.tiny {
    font-size: 0.7rem;
    margin-left: auto;
    text-decoration: none;
  }
  button.danger { color: #b00020; border-color: #b00020; }

  ul { list-style: none; padding: 0; margin: 0; }
  .owners li, .results li, .chips li { display: block; }
  .owners label, .results label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.22rem 0.4rem;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 0.82rem;
    margin-bottom: 0.18rem;
  }
  .owners label.on, .results label.on {
    border-color: #0969da;
    background: #ddf4ff;
  }
  .login { font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .kind { color: #888; font-size: 0.68rem; margin-left: auto; }

  .results {
    max-height: 16rem;
    overflow: auto;
    border: 1px solid #eee;
    border-radius: 4px;
    background: white;
    padding: 0.25rem;
  }

  .watching { margin-top: 0.3rem; }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }
  .chip {
    padding: 0.18rem 0.5rem;
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
    border: 1px solid #0969da;
    background: #ddf4ff;
    color: #0969da;
    border-radius: 999px;
  }
  .watch-all {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: #555;
    margin-top: 0.4rem;
  }
  .adv-note {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: #555;
  }
  .adv-note button.link {
    background: none;
    border: none;
    padding: 0;
    color: #0969da;
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }
  label.adv-check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: #555;
  }
  label.adv {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
    color: #555;
  }
</style>
