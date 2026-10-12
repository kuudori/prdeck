const ENDPOINT = 'https://api.github.com/graphql';

const PR_FIELDS = `
fragment PRFields on PullRequest {
  id number title url updatedAt createdAt mergedAt isDraft state reviewDecision
  additions deletions
  author { login avatarUrl }
  repository { nameWithOwner }
  labels(first: 10) { nodes { name color } }
  comments { totalCount }
  reviews  { totalCount }
  commits(last: 1) {
    nodes { commit { oid statusCheckRollup @include(if: $withCI) { state } } }
  }
}`;

const PR_QUERY = `
query PRs($q: String!, $cursor: String, $withCI: Boolean!) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ...PRFields }
  }
}
${PR_FIELDS}`;

const PR_BY_ID_QUERY = `
query PRsById($ids: [ID!]!, $withCI: Boolean!) {
  nodes(ids: $ids) { ...PRFields }
}
${PR_FIELDS}`;

const VIEWER_QUERY = `query { viewer { login } }`;

const VIEWER_ORGS_QUERY = `
query {
  viewer {
    login
    avatarUrl
    organizations(first: 100) {
      nodes { login name avatarUrl }
    }
  }
}`;

const ORGS_FROM_PRS_QUERY = `
query OrgsFromPRs($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes { ... on PullRequest { repository { owner { __typename login avatarUrl } } } }
  }
}`;

const OWNER_QUERY = `
query Owner($login: String!) {
  repositoryOwner(login: $login) { __typename login avatarUrl }
}`;

const OWNER_REPOS_QUERY = `
query OwnerRepos($login: String!, $cursor: String) {
  repositoryOwner(login: $login) {
    __typename
    ... on User {
      repositories(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}, ownerAffiliations: [OWNER, COLLABORATOR]) {
        pageInfo { hasNextPage endCursor }
        nodes { nameWithOwner isPrivate isArchived }
      }
    }
    ... on Organization {
      repositories(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes { nameWithOwner isPrivate isArchived }
      }
    }
  }
}`;

const BASE_OPEN = 'is:pr is:open archived:false';
const BASE_MERGED = 'is:pr is:merged archived:false';
const BASE_ANY = 'is:pr archived:false';

// Search requests in flight at once. GitHub's secondary rate limit punishes
// bursts, and this keeps a scope with many orgs from firing them all at once.
const CONCURRENCY = 6;
// Incremental syncs look back this far past the previous sync to cover
// search-index lag and small clock skew.
const DELTA_OVERLAP_MS = 5 * 60_000;
// CI states that can still change without bumping the PR's updatedAt.
const HOT_CI = new Set(['PENDING', 'EXPECTED']);

// CI status is the most expensive field to fetch and the only reason for the
// by-id refetch, so users who don't care about it can turn it off.
function withCI(cfg) {
  return cfg.trackCI !== false;
}

export function syncWindows(cfg) {
  return {
    mergedDays: Math.max(1, Number(cfg.mergedDays) || 7),
    openCreatedDays: Math.max(0, Number(cfg.openCreatedDays ?? 90) || 0),
  };
}

function scopeAxes(cfg, userLogin) {
  const axes = [];
  if (cfg.includeInvolves && userLogin) axes.push(`involves:${userLogin}`);
  for (const r of cfg.watchRepos || []) axes.push(`repo:${r}`);
  for (const o of cfg.watchOrgs || []) axes.push(`org:${o}`);
  for (const u of cfg.watchUsers || []) axes.push(`user:${u}`);
  return axes;
}

// Anything that changes which PRs belong in the cache. When this differs
// from the last sync, the next sync has to be a full one.
export function scopeKey(cfg, userLogin) {
  return JSON.stringify({ axes: scopeAxes(cfg, userLogin), ...syncWindows(cfg), ci: withCI(cfg) });
}

function buildQueries(cfg, userLogin) {
  const { openCreatedDays } = syncWindows(cfg);
  const created = openCreatedDays > 0 ? ` created:>=${isoDaysAgo(openCreatedDays)}` : '';
  return scopeAxes(cfg, userLogin).map((axis) => `${BASE_OPEN} ${axis}${created}`);
}

function buildMergedQueries(cfg, userLogin) {
  const since = isoDaysAgo(syncWindows(cfg).mergedDays);
  return scopeAxes(cfg, userLogin).map((axis) => `${BASE_MERGED} ${axis} merged:>=${since}`);
}

// No state qualifier: a PR that merged or closed since the last sync has to
// come back too, so it can move tabs or drop out.
function buildDeltaQueries(cfg, userLogin, sinceIso) {
  return scopeAxes(cfg, userLogin).map((axis) => `${BASE_ANY} ${axis} updated:>=${sinceIso}`);
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function isoDateTime(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Same rules the full-sync queries apply on the server, so a cache built by
// incremental syncs holds the same PRs a full sync would return.
function inWindow(pr, cfg) {
  const { mergedDays, openCreatedDays } = syncWindows(cfg);
  if (pr.state === 'OPEN') {
    return openCreatedDays === 0 || (pr.createdAt || '').slice(0, 10) >= isoDaysAgo(openCreatedDays);
  }
  if (pr.state === 'MERGED') {
    return (pr.mergedAt || '').slice(0, 10) >= isoDaysAgo(mergedDays);
  }
  return false;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function appError(kind, message, extra = {}) {
  const e = new Error(message);
  e.kind = kind;
  Object.assign(e, extra);
  return e;
}

// GitHub cuts GraphQL requests off at ~10s and answers 502; heavy search
// pages hit that now and then and usually succeed on a second try.
const RETRY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 3000];

async function post(query, variables, token) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      throw appError('network', e.message || 'network failure');
    }
    if (!RETRY_STATUSES.has(res.status) || attempt >= RETRY_DELAYS_MS.length) return res;
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

export async function runQuery(query, variables, token) {
  const res = await post(query, variables, token);
  if (res.status === 401) throw appError('auth', 'GitHub rejected the token');
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    const retry = res.headers.get('retry-after');
    throw appError(remaining === '0' ? 'rateLimit' : 'abuse', 'forbidden', {
      resetAt: reset ? Number(reset) * 1000 : null,
      retryAfterSec: retry ? Number(retry) : null,
    });
  }
  if (!res.ok) throw appError('http', `HTTP ${res.status}`, { status: res.status });

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw appError('http', 'invalid JSON response');
  }
  if (json.errors?.length && !json.data) {
    throw appError('graphql', json.errors[0].message, { errors: json.errors });
  }
  return { data: json.data, errors: json.errors || [], headers: res.headers };
}

export async function fetchViewerLogin(token) {
  const { data } = await runQuery(VIEWER_QUERY, {}, token);
  return data?.viewer?.login || null;
}

// What the token can see, to explain a missing org instead of guessing.
//   kind:  'fine-grained' | 'classic'. Fine-grained tokens get no scopes header.
//   readOrg: classic token has a scope that lets it list private memberships.
//   sso: GitHub's X-GitHub-SSO header, set when an org hides results until
//        the token is authorized for its single sign-on.
export function describeToken(token, scopesHeader, ssoHeader) {
  const t = (token || '').trim();
  const kind = t.startsWith('github_pat_') || (scopesHeader == null && !/^gh[opsu]_/.test(t)) ? 'fine-grained' : 'classic';
  const scopes = (scopesHeader || '').split(',').map((s) => s.trim()).filter(Boolean);
  const readOrg = scopes.some((s) => s === 'read:org' || s === 'write:org' || s === 'admin:org');
  let sso = null;
  if (ssoHeader) {
    const url = /url=(\S+)/.exec(ssoHeader)?.[1];
    sso = { url: url && url.startsWith('https://github.com/') ? url : 'https://github.com/settings/tokens' };
  }
  return { kind, readOrg, sso };
}

export async function fetchViewerAndOrgs(token) {
  const { data, headers } = await runQuery(VIEWER_ORGS_QUERY, {}, token);
  const tokenInfo = describeToken(token, headers.get('x-oauth-scopes'), headers.get('x-github-sso'));
  const v = data?.viewer;
  if (!v) return { user: null, orgs: [], tokenInfo };
  const orgs = (v.organizations?.nodes || []).map((o) => ({
    login: o.login,
    name: o.name || o.login,
    avatarUrl: o.avatarUrl,
    kind: 'org',
  }));
  for (const o of await orgsFromPRs(v.login, token)) {
    if (!orgs.some((x) => x.login.toLowerCase() === o.login.toLowerCase())) orgs.push(o);
  }
  return {
    tokenInfo,
    user: { login: v.login, avatarUrl: v.avatarUrl, kind: 'user' },
    orgs,
  };
}

// Orgs owning the repos of your 100 most recently updated PRs, busiest first.
// Covers what the membership list can't: fine-grained tokens (no org list
// at all), hidden memberships, and orgs you contribute to without being a
// member. Best effort: a failure just means no suggestions.
async function orgsFromPRs(login, token) {
  try {
    const { data } = await runQuery(ORGS_FROM_PRS_QUERY, { q: `is:pr involves:${login} sort:updated-desc` }, token);
    const counts = new Map();
    for (const n of data?.search?.nodes || []) {
      const o = n?.repository?.owner;
      if (o?.__typename !== 'Organization') continue;
      const prev = counts.get(o.login);
      counts.set(o.login, { login: o.login, name: o.login, avatarUrl: o.avatarUrl, kind: 'org', suggested: true, prs: (prev?.prs || 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.prs - a.prs);
  } catch {
    return [];
  }
}

// Look up an org or user by name. The viewer's own org list can be
// incomplete (fine-grained tokens only see the owner they were made for),
// so owners can also be added by name. Returns null if it doesn't exist.
export async function fetchOwner(login, token) {
  const { data } = await runQuery(OWNER_QUERY, { login }, token);
  const o = data?.repositoryOwner;
  if (!o) return null;
  return { login: o.login, avatarUrl: o.avatarUrl, kind: o.__typename === 'Organization' ? 'org' : 'user' };
}

export async function fetchOwnerRepos(login, token, { maxPages = 3 } = {}) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const { data } = await runQuery(OWNER_REPOS_QUERY, { login, cursor }, token);
    const conn = data?.repositoryOwner?.repositories;
    if (!conn) break;
    for (const n of conn.nodes || []) {
      if (n && !n.isArchived) all.push(n);
    }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return all;
}

async function paginate(q, token, onPartial, ci) {
  const nodes = [];
  let cursor = null;
  let issueCount = 0;
  for (let page = 0; page < 20; page++) {
    const { data, errors } = await runQuery(PR_QUERY, { q, cursor, withCI: ci }, token);
    if (errors.length && onPartial) onPartial({ query: q, errors });
    issueCount = data.search.issueCount;
    for (const n of data.search.nodes) {
      if (n && n.id) nodes.push(n);
    }
    if (!data.search.pageInfo.hasNextPage) break;
    cursor = data.search.pageInfo.endCursor;
  }
  return { query: q, nodes, capHit: issueCount > 1000, issueCount };
}

function normalizePR(node) {
  const commit = node.commits?.nodes?.[0]?.commit ?? null;
  const headSha = commit?.oid ?? null;
  const rollup = commit?.statusCheckRollup ?? null;
  const ciState = rollup?.state ?? 'NONE';

  return {
    id: node.id,
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    author: node.author?.login ?? 'ghost',
    avatarUrl: node.author?.avatarUrl ?? null,
    url: node.url,
    headSha,
    updatedAt: node.updatedAt,
    createdAt: node.createdAt,
    mergedAt: node.mergedAt ?? null,
    state: (node.state || 'OPEN').toUpperCase(), // OPEN | MERGED | CLOSED
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    ciState,
    commentCount: node.comments?.totalCount ?? 0,
    reviewCount: node.reviews?.totalCount ?? 0,
    reviewDecision: node.reviewDecision ?? 'NONE',
    labels: (node.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color })),
    isDraft: !!node.isDraft,
    fetchedAt: Date.now(),
  };
}

async function fetchByIds(ids, token, ci) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  // Deleted or no-longer-visible PRs come back as null with a NOT_FOUND
  // error; skip them and let the next full sync drop them.
  const results = await mapLimit(chunks, CONCURRENCY, (chunk) => runQuery(PR_BY_ID_QUERY, { ids: chunk, withCI: ci }, token));
  return results.flatMap(({ data }) => (data?.nodes || []).filter((n) => n && n.id));
}

// Current state of specific PRs regardless of scope or state, for the bell.
export async function fetchPRsById(ids, cfg, token) {
  if (ids.length === 0) return [];
  return (await fetchByIds(ids, token, withCI(cfg))).map(normalizePR);
}

// Full sync: every PR in scope, from scratch.
export async function fullFetch(cfg, userLogin, token, onPartial) {
  const openQs = buildQueries(cfg, userLogin);
  const mergedQs = buildMergedQueries(cfg, userLogin);
  if (openQs.length === 0 && mergedQs.length === 0) {
    return { prs: [], capped: [], empty: true };
  }
  const allQueries = [...openQs, ...mergedQs];
  const results = await mapLimit(allQueries, CONCURRENCY, (q) => paginate(q, token, onPartial, withCI(cfg)));
  const byId = new Map();
  const capped = [];
  for (const r of results) {
    if (r.capHit) capped.push(r.query);
    for (const node of r.nodes) {
      if (!node || !node.id) continue;
      const prev = byId.get(node.id);
      if (!prev || (node.updatedAt || '') >= (prev.updatedAt || '')) {
        byId.set(node.id, node);
      }
    }
  }
  return {
    prs: [...byId.values()].map(normalizePR),
    capped,
    empty: false,
  };
}

// Incremental sync: only PRs updated since the last sync, plus a by-id
// refetch of open PRs whose CI was still running (CI results don't bump
// updatedAt, so search alone would miss them). Merged into the cached list.
export async function deltaFetch(cfg, userLogin, token, sinceMs, cached, onPartial) {
  const queries = buildDeltaQueries(cfg, userLogin, isoDateTime(sinceMs - DELTA_OVERLAP_MS));
  if (queries.length === 0) return { prs: [], empty: true };
  const hotIds = withCI(cfg)
    ? cached.filter((p) => p.state === 'OPEN' && HOT_CI.has(p.ciState)).map((p) => p.id)
    : [];
  const [results, hotNodes] = await Promise.all([
    mapLimit(queries, CONCURRENCY, (q) => paginate(q, token, onPartial, withCI(cfg))),
    fetchByIds(hotIds, token, true),
  ]);
  const byId = new Map(cached.map((p) => [p.id, p]));
  for (const node of [...results.flatMap((r) => r.nodes), ...hotNodes]) {
    const prev = byId.get(node.id);
    if (!prev || (node.updatedAt || '') >= (prev.updatedAt || '')) {
      byId.set(node.id, normalizePR(node));
    }
  }
  return {
    prs: [...byId.values()].filter((pr) => inWindow(pr, cfg)),
    empty: false,
  };
}
