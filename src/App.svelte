<script>
  import { onMount, onDestroy } from 'svelte';
  import Settings from './components/Settings.svelte';
  import Filters from './components/Filters.svelte';
  import PRList from './components/PRList.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';

  import { fanoutFetch, fetchViewerLogin } from './lib/github.js';
  import {
    getAllPRs,
    putPRs,
    getAllViewed,
    getAllObserved,
    markObservedBulk,
    setViewed,
    setViewedMany,
    getMeta,
    setMeta,
    isReady,
  } from './lib/cache.js';
  import {
    settingsStore,
    tokenStore,
    prsStore,
    viewedStore,
    observedStore,
    lastDismissedAtStore,
    userLoginStore,
    refreshingStore,
    lastRefreshAtStore,
    rateLimitStore,
    cappedStore,
    errorStore,
    filteredPRsStore,
  } from './lib/stores.js';

  let timer;
  let showSettings = false;
  let bootDone = false;

  $: hasToken = !!$tokenStore;
  $: hasScope =
    $settingsStore.includeInvolves ||
    ($settingsStore.watchRepos?.length || 0) > 0 ||
    ($settingsStore.watchOrgs?.length || 0) > 0;

  function userError(e) {
    const base = { message: e.message || String(e), kind: e.kind || 'http' };
    switch (e.kind) {
      case 'auth':
        return { ...base, message: 'GitHub rejected the token. Re-enter or rotate in Settings.', sticky: true };
      case 'rateLimit':
        return { ...base, message: 'Rate limited.', resetAt: e.resetAt };
      case 'abuse':
        return { ...base, message: 'GitHub asked us to slow down.', retryAfterSec: e.retryAfterSec };
      case 'graphql':
        return { ...base, message: `GraphQL error: ${e.message}` };
      case 'network':
        return { ...base, message: 'Offline — showing cached PRs.' };
      default:
        return base;
    }
  }

  async function hydrateFromCache() {
    if (!(await isReady())) {
      errorStore.push({ kind: 'idb', message: 'Local storage unavailable; running in memory only.', sticky: true });
      return;
    }
    const [cached, viewed, observed, dismissed, login] = await Promise.all([
      getAllPRs(),
      getAllViewed(),
      getAllObserved(),
      getMeta('lastDismissedAt'),
      getMeta('userLogin'),
    ]);
    prsStore.set(cached);
    viewedStore.set(viewed);
    observedStore.set(observed);
    lastDismissedAtStore.set(dismissed || 0);
    if (login) userLoginStore.set(login);
  }

  async function ensureUserLogin() {
    if ($userLoginStore) return $userLoginStore;
    try {
      const login = await fetchViewerLogin($tokenStore);
      if (login) {
        userLoginStore.set(login);
        await setMeta('userLogin', login);
      }
      return login;
    } catch (e) {
      errorStore.push(userError(e));
      return null;
    }
  }

  async function refresh(reason) {
    if ($refreshingStore) return;
    if (!hasToken) {
      errorStore.push({ kind: 'noPat', message: 'Enter a GitHub PAT in Settings to start.', sticky: true });
      showSettings = true;
      return;
    }
    if (!hasScope) {
      errorStore.push({ kind: 'emptyScope', message: 'No scopes configured. Add a watched repo/org or enable "involves me".', sticky: true });
      showSettings = true;
      return;
    }

    refreshingStore.set(true);
    try {
      let login = $userLoginStore;
      if ($settingsStore.includeInvolves && !login) {
        login = await ensureUserLogin();
        if (!login) return;
      }

      const { prs, capped, rateLimit, empty } = await fanoutFetch(
        $settingsStore,
        login,
        $tokenStore,
        (partial) => errorStore.push({ kind: 'graphqlPartial', message: `Partial data: ${partial.errors[0].message}` })
      );
      if (empty) return;

      const newlyObserved = await markObservedBulk(prs);

      let dismissed = $lastDismissedAtStore;
      const firstRun = !(await getMeta('lastDismissedAt'));
      if (firstRun) {
        dismissed = Date.now();
        await setMeta('lastDismissedAt', dismissed);
        lastDismissedAtStore.set(dismissed);
      }

      await putPRs(prs);
      await setMeta('lastFullRefreshAt', Date.now());

      prsStore.set(prs);
      observedStore.set(await getAllObserved());
      rateLimitStore.set(rateLimit);
      cappedStore.set(capped);
      lastRefreshAtStore.set(Date.now());

      errorStore.clearKind('auth');
      errorStore.clearKind('rateLimit');
      errorStore.clearKind('abuse');
      errorStore.clearKind('network');
      errorStore.clearKind('noPat');
      errorStore.clearKind('emptyScope');
    } catch (e) {
      errorStore.push(userError(e));
    } finally {
      refreshingStore.set(false);
    }
  }

  function scheduleTick() {
    clearTimeout(timer);
    if (document.hidden) return;
    const ms = Math.max(1, $settingsStore.intervalMinutes) * 60 * 1000;
    timer = setTimeout(async () => {
      await refresh('interval');
      scheduleTick();
    }, ms);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      clearTimeout(timer);
      return;
    }
    const age = Date.now() - $lastRefreshAtStore;
    if (age > 60_000) refresh('visibility');
    scheduleTick();
  }

  function onOnline() {
    errorStore.clearKind('network');
    refresh('online');
  }

  async function markViewed(pr) {
    const entry = {
      viewedAt: Date.now(),
      viewedHeadSha: pr.headSha,
      viewedUpdatedAt: pr.updatedAt,
    };
    await setViewed(pr.id, entry);
    viewedStore.update((m) => {
      const next = new Map(m);
      next.set(pr.id, entry);
      return next;
    });
  }

  async function markAllVisibleViewed() {
    const visible = $filteredPRsStore;
    const entries = visible.map((pr) => [pr.id, {
      viewedAt: Date.now(),
      viewedHeadSha: pr.headSha,
      viewedUpdatedAt: pr.updatedAt,
    }]);
    await setViewedMany(entries);
    viewedStore.update((m) => {
      const next = new Map(m);
      for (const [id, v] of entries) next.set(id, v);
      return next;
    });
  }

  async function catchUp() {
    const now = Date.now();
    await setMeta('lastDismissedAt', now);
    lastDismissedAtStore.set(now);
  }

  onMount(async () => {
    await hydrateFromCache();
    bootDone = true;
    if (hasToken && hasScope) await refresh('initial');
    scheduleTick();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
  });

  onDestroy(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
  });
</script>

<main>
  <header>
    <h1>Reviewbrah</h1>
    <div class="header-actions">
      <button type="button" on:click={() => refresh('manual')} disabled={$refreshingStore}>
        {$refreshingStore ? '…' : '↻ Refresh'}
      </button>
      <button type="button" on:click={catchUp}>Catch up</button>
      <button type="button" on:click={markAllVisibleViewed}>Mark all viewed</button>
      <button type="button" on:click={() => (showSettings = !showSettings)}>
        {showSettings ? 'Close settings' : 'Settings'}
      </button>
    </div>
    {#if $rateLimitStore}
      <small class="ratelimit">
        rate-limit: {$rateLimitStore.remaining} pts remaining
      </small>
    {/if}
  </header>

  <ErrorBanner />

  {#if showSettings}
    <Settings onSave={() => { showSettings = false; refresh('settings'); }} onCatchUp={catchUp} />
  {/if}

  <Filters />

  <PRList onMarkViewed={markViewed} />

  <footer>
    {#if $lastRefreshAtStore}
      <small>Last refresh: {new Date($lastRefreshAtStore).toLocaleTimeString()}</small>
    {/if}
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f6f8fa;
    color: #222;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  header h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .header-actions {
    display: flex;
    gap: 0.4rem;
    margin-left: auto;
  }
  .header-actions button {
    padding: 0.35rem 0.7rem;
    border: 1px solid #ccc;
    background: white;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }
  .header-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ratelimit {
    color: #666;
    font-size: 0.75rem;
  }
  footer {
    text-align: center;
    color: #888;
    padding: 0.5rem;
  }
</style>
