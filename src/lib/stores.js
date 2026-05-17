import { writable, derived } from 'svelte/store';
import { INITIAL_FILTERS, annotate } from './status.js';

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

export const settingsStore = (() => {
  const store = persistedLocal('prdeck.settings', {
    includeInvolves: true,
    watchRepos: [],
    watchOrgs: [],
    watchUsers: [],
    intervalMinutes: 5,
  });
  store.update((s) => {
    if (Array.isArray(s.watchUsers) && !('excludeRepos' in s) && !('extraClauses' in s)) {
      return s;
    }
    const next = { ...s };
    if (!Array.isArray(next.watchUsers)) next.watchUsers = [];
    delete next.excludeRepos;
    delete next.extraClauses;
    return next;
  });
  return store;
})();

export const filtersStore = (() => {
  const store = persistedLocal('prdeck.filters', { ...INITIAL_FILTERS });
  store.update((f) => {
    if (!('titleExclude' in f) && !('textMode' in f) && !('textRegex' in f)) return f;
    const next = { ...f };
    delete next.titleExclude;
    delete next.textMode;
    delete next.textRegex;
    return next;
  });
  return store;
})();

export function resetFilters() {
  filtersStore.set({ ...INITIAL_FILTERS });
}

export const sortStore = (() => {
  const store = persistedLocal('prdeck.sort', { key: 'updated', dir: 'desc' });
  store.update((s) => (s.key === 'status' ? { key: 'updated', dir: 'desc' } : s));
  return store;
})();

export const sidebarCollapsedStore = persistedLocal('prdeck.sidebarCollapsed', {
  token: false,
  owners: false,
  repos: false,
  advanced: true,
});

export const viewModeStore = persistedLocal('prdeck.viewMode', 'open');

export const ownersCacheStore = persistedLocal('prdeck.ownersCache', null);
export const reposCacheStore = persistedLocal('prdeck.reposCache', {});

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
  [prsStore, viewedStore, observedStore, lastDismissedAtStore],
  ([$prs, $viewed, $observed, $lastDismissed]) =>
    annotate($prs, $viewed, $observed, $lastDismissed)
);
