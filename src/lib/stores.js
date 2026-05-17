import { writable, derived } from 'svelte/store';

function persistedLocal(key, initial) {
  let value = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) value = JSON.parse(raw);
  } catch {}
  const store = writable(value);
  store.subscribe((v) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  });
  return store;
}

export const tokenStore = (() => {
  let initial = '';
  try {
    initial = localStorage.getItem('reviewbrah.pat') || '';
  } catch {}
  const s = writable(initial);
  s.subscribe((v) => {
    try {
      if (v) localStorage.setItem('reviewbrah.pat', v);
      else localStorage.removeItem('reviewbrah.pat');
    } catch {}
  });
  return s;
})();

export const settingsStore = persistedLocal('reviewbrah.settings', {
  includeInvolves: true,
  watchRepos: [],
  watchOrgs: [],
  excludeRepos: [],
  extraClauses: '',
  intervalMinutes: 5,
});

export const filtersStore = persistedLocal('reviewbrah.filters', {
  repoInclude: [],
  repoExclude: [],
  authors: [],
  ciStates: [],
  reviewDecisions: [],
  statuses: [],
  draft: 'all',
  text: '',
});

export const prsStore = writable([]);
export const viewedStore = writable(new Map());
export const observedStore = writable(new Map());
export const lastDismissedAtStore = writable(0);
export const userLoginStore = writable('');
export const refreshingStore = writable(false);
export const lastRefreshAtStore = writable(0);
export const rateLimitStore = writable(null);
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
  ([$prs, $viewed, $observed, $lastDismissed]) => {
    return $prs.map((pr) => {
      const obs = $observed.get(pr.id);
      let status;
      if (!obs) status = 'NEW';
      else if ((obs.firstSeenAt || 0) > ($lastDismissed || 0)) status = 'NEW';
      else {
        const v = $viewed.get(pr.id);
        if (!v) status = 'SEEN';
        else if (v.viewedHeadSha !== pr.headSha) status = 'UPDATED';
        else if (v.viewedUpdatedAt !== pr.updatedAt) status = 'UPDATED';
        else status = 'SEEN';
      }
      return { ...pr, status };
    });
  }
);

export const filteredPRsStore = derived(
  [annotatedPRsStore, filtersStore],
  ([$prs, $f]) => {
    const text = ($f.text || '').toLowerCase().trim();
    return $prs.filter((pr) => {
      if ($f.repoInclude.length && !$f.repoInclude.includes(pr.repo)) return false;
      if ($f.repoExclude.includes(pr.repo)) return false;
      if ($f.authors.length && !$f.authors.includes(pr.author)) return false;
      if ($f.ciStates.length && !$f.ciStates.includes(pr.ciState)) return false;
      if ($f.reviewDecisions.length && !$f.reviewDecisions.includes(pr.reviewDecision)) return false;
      if ($f.statuses.length && !$f.statuses.includes(pr.status)) return false;
      if ($f.draft === 'only' && !pr.isDraft) return false;
      if ($f.draft === 'exclude' && pr.isDraft) return false;
      if (text && !pr.title.toLowerCase().includes(text)) return false;
      return true;
    });
  }
);
