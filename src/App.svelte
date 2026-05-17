<script>
  import { onMount, onDestroy } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Filters from './components/Filters.svelte';
  import PRList from './components/PRList.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';

  import { fanoutFetch, fetchViewerLogin } from './lib/github.js';
  import {
    getAllPRs,
    replaceAllPRs,
    getAllViewed,
    getAllObserved,
    markObservedBulk,
    setViewed,
    resetPR,
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
    cappedStore,
    errorStore,
  } from './lib/stores.js';
  import { hasToken as tokenPresent, hasScope as scopePresent } from './lib/status.js';

  let timer;
  let bootDone = false;

  $: hasToken = tokenPresent($tokenStore);
  $: hasScope = scopePresent($settingsStore);

  function userError(e) {
    const base = { message: e.message || String(e), kind: e.kind || 'http' };
    switch (e.kind) {
      case 'auth':
        return { ...base, message: 'GitHub rejected the token. Re-enter or rotate.', sticky: true };
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
    const token = ($tokenStore || '').trim();
    const settings = $settingsStore;
    if (!tokenPresent(token)) return;
    if (!scopePresent(settings)) return;
    errorStore.clearKind('noPat');
    errorStore.clearKind('emptyScope');

    refreshingStore.set(true);
    try {
      let login = $userLoginStore;
      if (settings.includeInvolves && !login) {
        login = await ensureUserLogin();
        if (!login) return;
      }

      const { prs, capped, empty } = await fanoutFetch(
        settings,
        login,
        token,
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

      // Replace cache only when we actually got data, to avoid wiping on
      // transient empty responses. Open PRs that closed and merged PRs that
      // age past the 7-day window naturally drop out this way.
      if (prs.length > 0) await replaceAllPRs(prs);
      await setMeta('lastFullRefreshAt', Date.now());

      prsStore.set(prs);
      if (newlyObserved.length > 0) {
        observedStore.update((m) => {
          const next = new Map(m);
          const now = Date.now();
          for (const id of newlyObserved) next.set(id, { firstSeenAt: now });
          return next;
        });
      }
      cappedStore.set(capped);
      lastRefreshAtStore.set(Date.now());

      errorStore.clearKind('auth');
      errorStore.clearKind('rateLimit');
      errorStore.clearKind('abuse');
      errorStore.clearKind('network');
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

  async function markUnseen(pr) {
    await resetPR(pr.id);
    viewedStore.update((m) => {
      const next = new Map(m);
      next.delete(pr.id);
      return next;
    });
    observedStore.update((m) => {
      const next = new Map(m);
      next.delete(pr.id);
      return next;
    });
  }

  function onScopeChange() {
    if (hasToken && hasScope && bootDone) refresh('scope-change');
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

<div class="layout">
  <Sidebar {onScopeChange} />

  <main>
    <header>
      <div class="header-actions">
        <button type="button" on:click={() => refresh('manual')} disabled={$refreshingStore || !hasToken || !hasScope}>
          {#if $refreshingStore}<span class="rainbow">updating…</span>{:else}↻ Refresh{/if}
        </button>
      </div>
      {#if $lastRefreshAtStore}
        <small class="muted">last: {new Date($lastRefreshAtStore).toLocaleTimeString()}</small>
      {/if}
    </header>

    <ErrorBanner />

    {#if hasScope}
      <Filters />
    {/if}

    <PRList onMarkViewed={markViewed} onMarkUnseen={markUnseen} />
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f6f8fa;
    color: #222;
  }
  .layout {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    min-height: 100vh;
    align-items: stretch;
  }
  main {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
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
  .muted {
    color: #666;
    font-size: 0.72rem;
  }
  :global(.rainbow) {
    background-image: linear-gradient(
      90deg,
      #ff0040,
      #ff8000,
      #ffd000,
      #00c040,
      #00b0ff,
      #8040ff,
      #ff0040
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    font-weight: 700;
    animation: rainbow-flow 1.6s linear infinite;
  }
  @keyframes -global-rainbow-flow {
    from { background-position: 0% 0; }
    to   { background-position: -200% 0; }
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
