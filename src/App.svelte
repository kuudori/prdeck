<script>
  import { onMount, onDestroy } from 'svelte';
  import Header from './components/Header.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import ScopePanel from './components/ScopePanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
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
    filtersStore,
    setQuery,
    panelStore,
    BACKGROUND_PAUSE_MS,
  } from './lib/stores.js';
  import { ensureAccount } from './lib/account.js';
  import { hasToken as tokenPresent, hasScope as scopePresent } from './lib/status.js';

  // A full sync refetches every PR in scope; the ones in between only fetch
  // what changed. This bounds how long a missed change (a PR leaving scope,
  // a CI re-run) can go unnoticed.
  const FULL_SYNC_EVERY_MS = 60 * 60_000;
  // Opening the page or returning to the tab skips the refresh if the last
  // sync is younger than this.
  const FRESH_MS = 60_000;

  // Hosted copies (GitHub Pages) check for a newer deploy and offer a reload;
  // a page opened from disk can't, and dev reloads itself.
  const VERSION_CHECK_MS = 30 * 60_000;
  const canCheckVersion = !import.meta.env.DEV && location.protocol.startsWith('http');
  let versionTimer;
  let updateAvailable = false;

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
  // Pages opened from file:// don't keep a notification grant across reloads,
  // so the prompt would come back on every bell click. Ask once per load.
  let askedNotifications = false;
  let bootDone = false;
  let hiddenSince = null;
  // Set when a refresh is requested while one is already running (e.g. a
  // scope change mid-sync); the running one re-runs once it finishes.
  let rerunQueued = false;
  // { lastSyncAt, lastFullSyncAt, scopeKey, capped }, mirrored in IDB meta.
  let sync = {};
  // The timer skipped a refresh because the tab has been away too long.
  let paused = false;
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  // Ticks so "Updated 3 min ago" stays true without a refresh.
  let now = Date.now();
  let nowTimer;
  // Settings opened from "Token rejected" starts on the token form.
  let settingsForToken = false;

  $: hasToken = tokenPresent($tokenStore);
  $: hasScope = scopePresent($settingsStore);
  $: setupDone = hasToken && !!$settingsStore.setupDone;

  $: scopeSummary = (() => {
    const s = $settingsStore;
    const parts = [];
    if (s.includeInvolves) parts.push('you');
    const repos = (s.watchRepos || []).length;
    if (repos) parts.push(`${repos} repo${repos === 1 ? '' : 's'}`);
    const owners = (s.watchOrgs || []).length + (s.watchUsers || []).length;
    if (owners) parts.push(`${owners} org${owners === 1 ? '' : 's'}`);
    return parts.join(' · ') || 'nothing yet';
  })();

  $: watchedCount = Object.keys($watchedStore).length;
  $: watchingActive = /(^|\s)is:watched(\s|$)/.test($filtersStore.text || '');

  // What the header says about the list: is it current, and if not, why.
  $: status = (() => {
    const errs = $errorStore;
    const find = (k) => errs.find((e) => e.kind === k);
    if (find('auth')) return { tone: 'danger', text: 'Token rejected · Replace', action: 'token' };
    if ($refreshingStore) return { tone: 'busy', text: 'Syncing…' };
    const rl = find('rateLimit');
    if (rl) return { tone: 'warn', text: rl.resetAt ? `Rate limited until ${clock(rl.resetAt)}` : 'Rate limited' };
    if (find('abuse')) return { tone: 'warn', text: 'GitHub asked to slow down' };
    if (!online || find('network')) {
      return { tone: 'muted', text: $lastRefreshAtStore ? `Offline: showing PRs from ${clock($lastRefreshAtStore)}` : 'Offline' };
    }
    if (paused && hiddenSince) return { tone: 'muted', text: `Paused: tab hidden ${since(hiddenSince, now)}` };
    if (!$lastRefreshAtStore) return { tone: 'muted', text: 'Not synced yet' };
    return { tone: 'ok', text: `Updated ${ago($lastRefreshAtStore, now)}` };
  })();

  function clock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function since(ms, at) {
    const m = Math.max(0, Math.round((at - ms) / 60000));
    if (m < 60) return `${m} min`;
    return `${Math.round(m / 60)} h`;
  }
  function ago(ms, at) {
    const m = Math.round((at - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }
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
    if (!settings.setupDone) return;
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

      // One timestamp for both IDB and memory, and not later than the
      // first-run cutoff below, so a first sync really comes up all SEEN.
      const observedAt = Date.now();
      const newlyObserved = await markObservedBulk(prs, observedAt);

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
          for (const id of newlyObserved) next.set(id, { firstSeenAt: observedAt });
          return next;
        });
      }
      cappedStore.set(capped);
      lastRefreshAtStore.set(startedAt);
      paused = false;

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
  // "Away" is approximated as how long this tab has been in the background;
  // a page can't see activity in other tabs or apps.
  function isAway() {
    const limit = BACKGROUND_PAUSE_MS[$settingsStore.backgroundRefresh] ?? BACKGROUND_PAUSE_MS['2h'];
    return limit !== null && hiddenSince !== null && Date.now() - hiddenSince >= limit;
  }

  function scheduleTick() {
    clearTimeout(timer);
    const ms = Math.max(1, $settingsStore.intervalMinutes) * 60 * 1000;
    timer = setTimeout(async () => {
      // Paused while away; onVisibilityChange restarts the timer.
      if (isAway()) {
        paused = true;
        return;
      }
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
    paused = false;
    setUnseenBells(0);
    checkVersion();
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
    if (!on && !askedNotifications && notificationsSupported() && Notification.permission === 'default') {
      askedNotifications = true;
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

  async function checkVersion() {
    if (!canCheckVersion || updateAvailable) return;
    try {
      const res = await fetch('version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = await res.json();
      if (build && build !== __BUILD_ID__) updateAvailable = true;
    } catch {}
  }

  function scheduleVersionCheck() {
    clearTimeout(versionTimer);
    if (!canCheckVersion) return;
    versionTimer = setTimeout(async () => {
      await checkVersion();
      scheduleVersionCheck();
    }, VERSION_CHECK_MS);
  }

  function toggleWatching() {
    const text = ($filtersStore.text || '').trim();
    if (watchingActive) setQuery(text.replace(/(^|\s)is:watched(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim());
    else setQuery(text ? `${text} is:watched` : 'is:watched');
  }

  function openSettings(forToken = false) {
    settingsForToken = forToken;
    panelStore.set('settings');
  }

  function onTokenChange() {
    errorStore.clearKind('auth');
    refresh('token');
  }

  function onSetupDone() {
    refresh('initial');
  }

  function onOffline() {
    online = false;
  }

  function onOnline() {
    online = true;
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
    nowTimer = setInterval(() => (now = Date.now()), 30_000);
    if (tokenPresent($tokenStore)) ensureAccount($tokenStore).catch(() => {});
    if (document.hidden) hiddenSince = Date.now();
    await hydrateFromCache();
    bootDone = true;
    if (hasToken && hasScope && Date.now() - $lastRefreshAtStore > FRESH_MS) await refresh('initial');
    scheduleTick();
    scheduleWatchPoll();
    scheduleVersionCheck();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  });

  onDestroy(() => {
    clearTimeout(timer);
    clearTimeout(watchTimer);
    clearTimeout(versionTimer);
    clearInterval(nowTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  });
</script>

{#if !setupDone}
  <FirstRun onDone={onSetupDone} />
{:else}
  <Header
    {scopeSummary}
    {status}
    {updateAvailable}
    {watchedCount}
    {watchingActive}
    refreshing={$refreshingStore}
    canRefresh={hasScope}
    onToggleWatching={toggleWatching}
    onRefresh={() => refresh('manual')}
    onFullResync={() => refresh('manual', { forceFull: true })}
    onOpenScope={() => panelStore.set('scope')}
    onOpenSettings={() => openSettings(false)}
    onStatusAction={(a) => { if (a === 'token') openSettings(true); }} />

  <main>
    <ErrorBanner />
    <PRList onMarkViewed={markViewed} onMarkUnseen={markUnseen} onToggleWatch={toggleWatch} {onScopeChange} />
  </main>

  {#if $panelStore === 'scope'}
    <ScopePanel onClose={() => panelStore.set(null)} onChange={onScopeChange} />
  {:else if $panelStore === 'settings'}
    <SettingsPanel
      replacingToken={settingsForToken}
      onClose={() => panelStore.set(null)}
      {onScopeChange}
      {onTokenChange} />
  {/if}
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    background: #f6f8fa;
    color: #1f2328;
  }
  main {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    max-width: 1400px;
    margin: 0 auto;
  }
  @media (max-width: 720px) {
    main { padding: 12px 8px; }
  }
</style>
