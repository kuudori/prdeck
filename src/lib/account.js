// What the token can see: the viewer, their orgs (membership plus orgs from
// recent PRs), repos from recent PRs, and what kind of token it is. Cached in
// accountStore; reloaded when the token changes or the cache gets old.

import { get } from 'svelte/store';
import { fetchViewerAndOrgs } from './github.js';
import { accountStore, userLoginStore } from './stores.js';
import { setMeta } from './cache.js';

const MAX_AGE_MS = 24 * 3600_000;

let inFlight = null;

export function accountIsStale(account) {
  return !account?.tokenInfo || !Array.isArray(account.repos) || Date.now() - (account.fetchedAt || 0) > MAX_AGE_MS;
}

export function loadAccount(token) {
  const tok = (token || '').trim();
  if (!tok) return Promise.resolve(null);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { user, orgs, repos, tokenInfo } = await fetchViewerAndOrgs(tok);
      const account = { user, orgs, repos, tokenInfo, fetchedAt: Date.now() };
      accountStore.set(account);
      if (user) {
        userLoginStore.set(user.login);
        try { await setMeta('userLogin', user.login); } catch {}
      }
      return account;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function ensureAccount(token) {
  return accountIsStale(get(accountStore)) ? loadAccount(token) : Promise.resolve(get(accountStore));
}

// Owners worth searching for repos: you plus every org you're known to work in.
export function knownOwners(account) {
  const out = [];
  if (account?.user?.login) out.push(account.user.login);
  for (const o of account?.orgs || []) out.push(o.login);
  return out;
}

export function describeAccount(account) {
  if (!account?.user) return '';
  const t = account.tokenInfo;
  const kind = t?.kind === 'fine-grained' ? 'fine-grained token' : 'classic token';
  const member = (account.orgs || []).filter((o) => !o.suggested).length;
  const sees = t?.kind === 'fine-grained' ? "can't list orgs" : `sees ${member} org${member === 1 ? '' : 's'}`;
  return `@${account.user.login} · ${kind} · ${sees}`;
}
