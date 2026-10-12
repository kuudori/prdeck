import { writable, derived } from 'svelte/store';
import { annotate } from './status.js';

function persistedLocal(key, initial) {
  let value = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) value = JSON.parse(raw);
  } catch {}
  const store = writable(value);
  let lastSerialized;
  store.subscribe((v) => {
    try {
      const next = JSON.stringify(v);
      if (next === lastSerialized) return;
      lastSerialized = next;
      localStorage.setItem(key, next);
    } catch {}
  });
  return store;
}

export const tokenStore = (() => {
  let initial = '';
  try {
    initial = localStorage.getItem('prdeck.pat') || '';
  } catch {}
  const s = writable(initial);
  s.subscribe((v) => {
    try {
      if (v) localStorage.setItem('prdeck.pat', v);
      else localStorage.removeItem('prdeck.pat');
    } catch {}
  });
  return s;
})();

const SETTINGS_DEFAULTS = {
  includeInvolves: true,
  watchRepos: [],
  watchOrgs: [],
  watchUsers: [],
  intervalMinutes: 5,
  mergedDays: 7,
  openCreatedDays: 90,
  // While the tab is hidden: 'always' keeps refreshing, '2h'/'8h' stop after
  // that long away, 'off' stops as soon as the tab is hidden.
  backgroundRefresh: '2h',
  trackCI: true,
  // Set once the first-run screen is finished.
  setupDone: false,
};

export const BACKGROUND_PAUSE_MS = { always: null, '2h': 2 * 3600_000, '8h': 8 * 3600_000, off: 0 };

export const settingsStore = (() => {
  const store = persistedLocal('prdeck.settings', { ...SETTINGS_DEFAULTS });
  store.update((s) => {
    const next = { ...SETTINGS_DEFAULTS, ...s };
    if (!Array.isArray(next.watchUsers)) next.watchUsers = [];
    // Older versions stored the pause as hours, 0 meaning never.
    if ('pauseAfterHours' in s && !('backgroundRefresh' in s)) {
      const h = Number(s.pauseAfterHours) || 0;
      next.backgroundRefresh = h === 0 ? 'always' : h <= 4 ? '2h' : '8h';
    }
    // Anyone who already had a token set up before the first-run screen existed.
    if (!('setupDone' in s)) {
      try { next.setupDone = !!localStorage.getItem('prdeck.pat'); } catch {}
    }
    delete next.pauseAfterHours;
    delete next.excludeRepos;
    delete next.extraClauses;
    return next;
  });
  return store;
})();

// The search box is the only filter. Older versions also kept include/exclude
// lists here; they had no UI left, so they are dropped rather than applied.
export const filtersStore = (() => {
  const store = persistedLocal('prdeck.filters', { text: '' });
  store.update((f) => ({ text: typeof f?.text === 'string' ? f.text : '' }));
  return store;
})();

export function setQuery(text) {
  filtersStore.set({ text });
}

export const sortStore = (() => {
  const store = persistedLocal('prdeck.sort', { key: 'updated', dir: 'desc' });
  store.update((s) => (s.key === 'status' ? { key: 'updated', dir: 'desc' } : s));
  return store;
})();

export const viewModeStore = persistedLocal('prdeck.viewMode', 'open');

// What the token sees: { user, orgs, repos, tokenInfo, fetchedAt }. See
// lib/account.js. Kept under its old key so existing caches still load.
export const accountStore = persistedLocal('prdeck.ownersCache', null);

// Which header panel is open: 'scope' | 'settings' | null.
export const panelStore = writable(null);

// PR id -> { repo, number, title, url, snap } for PRs with the bell on.
// snap is the state last notified about; see lib/watch.js.
export const watchedStore = persistedLocal('prdeck.watched', {});

export const prsStore = writable([]);
export const viewedStore = writable(new Map());
export const observedStore = writable(new Map());
export const lastDismissedAtStore = writable(0);
export const userLoginStore = writable('');
export const refreshingStore = writable(false);
export const lastRefreshAtStore = writable(0);
export const cappedStore = writable([]);

function makeErrorStore() {
  const { subscribe, update, set } = writable([]);
  let nextId = 1;
  return {
    subscribe,
    push(err) {
      update((list) => {
        const replaced = list.filter((e) => e.kind !== err.kind || e.sticky);
        return [{ id: nextId++, ...err }, ...replaced].slice(0, 6);
      });
    },
    dismiss(id) {
      update((list) => list.filter((e) => e.id !== id));
    },
    clearTransient() {
      update((list) => list.filter((e) => e.sticky));
    },
    clearKind(kind) {
      update((list) => list.filter((e) => e.kind !== kind));
    },
    clear() {
      set([]);
    },
  };
}

export const errorStore = makeErrorStore();

export const annotatedPRsStore = derived(
  [prsStore, viewedStore, observedStore, lastDismissedAtStore, watchedStore],
  ([$prs, $viewed, $observed, $lastDismissed, $watched]) =>
    annotate($prs, $viewed, $observed, $lastDismissed).map((pr) =>
      $watched[pr.id] ? { ...pr, watched: true } : pr
    )
);
