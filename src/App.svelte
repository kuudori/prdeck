<script>
  import { onMount, onDestroy } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Filters from './components/Filters.svelte';
  import PRList from './components/PRList.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';

  import { fullFetch, deltaFetch, scopeKey, fetchViewerLogin, fetchPRsById } from './lib/github.js';
  import { watchEntry, snapshot, diffEvents, isFinal, showNotification, notificationsSupported } from './lib/watch.js';
  import {
    getAllPRs,
    putPRs,
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
    watchedStore,
  } from './lib/stores.js';
  import { hasToken as tokenPresent, hasScope as scopePresent } from './lib/status.js';

  // A full sync refetches every PR in scope; the ones in between only fetch
  // what changed. This bounds how long a missed change (a PR leaving scope,
  // a CI re-run) can go unnoticed.
  const FULL_SYNC_EVERY_MS = 60 * 60_000;
  // Opening the page or returning to the tab skips the refresh if the last
  // sync is younger than this.
  const FRESH_MS = 60_000;

  // Belled PRs are polled on their own, faster than the main refresh and
  // even while the away pause holds (being away is what the bell is for).
  const WATCH_POLL_MS = 60_000;

  let timer;
  let watchTimer;
  let watchPolling = false;
  let baseTitle = '';
  // Bell events that fired while the tab was hidden; shown as "(n)" in the
  // tab title until the tab is visible again.
  let unseenBells = 0;
  let bootDone = false;
  let hiddenSince = null;
  // Set when a refresh is requested while one is already running (e.g. a
  // scope change mid-sync); the running one re-runs once it finishes.
  let rerunQueued = false;
  // { lastSyncAt, lastFullSyncAt, scopeKey, capped }, mirrored in IDB meta.
  let sync = {};

  $: hasToken = tokenPresent($tokenStore);
  $: hasScope = scopePresent($settingsStore);
  $: if (bootDone && $settingsStore.intervalMinutes) scheduleTick();

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
    const [cached, viewed, observed, dismissed, login, syncMeta] = await Promise.all([
      getAllPRs(),
      getAllViewed(),
      getAllObserved(),
      getMeta('lastDismissedAt'),
      getMeta('userLogin'),
      getMeta('sync'),
    ]);
    sync = syncMeta || {};
    lastRefreshAtStore.set(sync.lastSyncAt || 0);
    cappedStore.set(sync.capped || []);
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

  async function refresh(reason, { forceFull = false } = {}) {
    if ($refreshingStore) {
      rerunQueued = true;
      return;
    }
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

      const startedAt = Date.now();
      const key = scopeKey(settings, login);
      const full =
        forceFull ||
        !sync.lastSyncAt ||
        sync.scopeKey !== key ||
        startedAt - (sync.lastFullSyncAt || 0) > FULL_SYNC_EVERY_MS;
      const onPartial = (partial) =>
        errorStore.push({ kind: 'graphqlPartial', message: `Partial data: ${partial.errors[0].message}` });

      const result = full
        ? await fullFetch(settings, login, token, onPartial)
        : await deltaFetch(settings, login, token, sync.lastSyncAt, $prsStore, onPartial);
      if (result.empty) return;
      const { prs } = result;
      const capped = full ? result.capped : sync.capped || [];

      const newlyObserved = await markObservedBulk(prs);

      let dismissed = $lastDismissedAtStore;
      const firstRun = !(await getMeta('lastDismissedAt'));
      if (firstRun) {
        dismissed = Date.now();
        await setMeta('lastDismissedAt', dismissed);
        lastDismissedAtStore.set(dismissed);
      }

      // A full sync replaces the cache only when it actually got data, to
      // avoid wiping on transient empty responses. A delta result is the
      // cache itself with changes applied, so it is always written.
      if (prs.length > 0 || !full) await replaceAllPRs(prs);
      sync = {
        lastSyncAt: startedAt,
        lastFullSyncAt: full ? startedAt : sync.lastFullSyncAt,
        scopeKey: key,
        capped,
      };
      await setMeta('sync', sync);

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
      lastRefreshAtStore.set(startedAt);

      errorStore.clearKind('auth');
      errorStore.clearKind('rateLimit');
      errorStore.clearKind('abuse');
      errorStore.clearKind('network');
    } catch (e) {
      errorStore.push(userError(e));
    } finally {
      refreshingStore.set(false);
    }
    if (rerunQueued) {
      rerunQueued = false;
      await refresh('queued');
    }
  }

  // "Away" is approximated as how long this tab has been in the background;
  // a page can't see activity in other tabs or apps.
  function isAway() {
    const hours = Number($settingsStore.pauseAfterHours) || 0;
    return hours > 0 && hiddenSince !== null && Date.now() - hiddenSince > hours * 3600_000;
  }

  function scheduleTick() {
    clearTimeout(timer);
    const ms = Math.max(1, $settingsStore.intervalMinutes) * 60 * 1000;
    timer = setTimeout(async () => {
      // Paused while away; onVisibilityChange restarts the timer.
      if (isAway()) return;
      await refresh('interval');
      scheduleTick();
    }, ms);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      hiddenSince = Date.now();
      return;
    }
    hiddenSince = null;
    setUnseenBells(0);
    if (Date.now() - $lastRefreshAtStore > FRESH_MS) refresh('visibility');
    scheduleTick();
  }

  function setUnseenBells(n) {
    unseenBells = n;
    document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle;
  }

  async function toggleWatch(pr) {
    const on = !!$watchedStore[pr.id];
    watchedStore.update((w) => {
      const next = { ...w };
      if (on) delete next[pr.id];
      else next[pr.id] = watchEntry(pr);
      return next;
    });
    // Ask on the click itself: browsers only show the prompt from a user gesture.
    if (!on && notificationsSupported() && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
    }
    if (!on) scheduleWatchPoll();
  }

  async function pollWatched() {
    const ids = Object.keys($watchedStore);
    const token = ($tokenStore || '').trim();
    if (ids.length === 0 || !tokenPresent(token) || watchPolling) return;
    watchPolling = true;
    try {
      const fresh = await fetchPRsById(ids, $settingsStore, token);
      const before = $watchedStore;
      // id -> new entry, or null to unwatch (merged/closed).
      const changes = {};
      let fired = 0;
      for (const pr of fresh) {
        const entry = before[pr.id];
        if (!entry) continue;
        const events = diffEvents(entry.snap, snapshot(pr));
        if (events.length > 0) {
          showNotification({ ...entry, title: pr.title }, events);
          fired++;
        }
        changes[pr.id] = isFinal(pr) ? null : { ...entry, title: pr.title, snap: snapshot(pr) };
      }
      watchedStore.update((w) => {
        const next = { ...w };
        for (const [id, entry] of Object.entries(changes)) {
          if (!(id in next)) continue; // unwatched while the request was in flight
          if (entry) next[id] = entry;
          else delete next[id];
        }
        return next;
      });
      if (fired > 0 && document.hidden) setUnseenBells(unseenBells + fired);

      // Show the fresh state in the list right away instead of at the next
      // refresh. Skipped mid-refresh: that refresh is about to replace the list.
      if (!$refreshingStore) {
        const byId = new Map(fresh.map((pr) => [pr.id, pr]));
        const kept = $prsStore
          .filter((p) => byId.has(p.id))
          .map((p) => byId.get(p.id))
          .filter((pr) => pr.state !== 'CLOSED');
        if (kept.length > 0 || fresh.some((pr) => pr.state === 'CLOSED')) {
          prsStore.update((list) =>
            list.flatMap((p) => {
              const f = byId.get(p.id);
              if (!f) return [p];
              return f.state === 'CLOSED' ? [] : [f];
            })
          );
          try { await putPRs(kept); } catch {}
        }
      }
    } catch (e) {
      // The main refresh reports auth/network problems; the poll stays quiet.
      console.warn('watch poll failed', e);
    } finally {
      watchPolling = false;
    }
  }

  function scheduleWatchPoll() {
    clearTimeout(watchTimer);
    if (Object.keys($watchedStore).length === 0) return;
    watchTimer = setTimeout(async () => {
      await pollWatched();
      scheduleWatchPoll();
    }, WATCH_POLL_MS);
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
    baseTitle = document.title;
    if (document.hidden) hiddenSince = Date.now();
    await hydrateFromCache();
    bootDone = true;
    if (hasToken && hasScope && Date.now() - $lastRefreshAtStore > FRESH_MS) await refresh('initial');
    scheduleTick();
    scheduleWatchPoll();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
  });

  onDestroy(() => {
    clearTimeout(timer);
    clearTimeout(watchTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
  });
</script>

<div class="layout">
  <Sidebar {onScopeChange} />

  <main>
    <header>
      <div class="header-actions">
        <button
          type="button"
          title="Shift-click for a full resync"
          on:click={(e) => refresh('manual', { forceFull: e.shiftKey })}
          disabled={$refreshingStore || !hasToken || !hasScope}>
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

    <PRList onMarkViewed={markViewed} onMarkUnseen={markUnseen} onToggleWatch={toggleWatch} />
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
