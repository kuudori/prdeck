const ENDPOINT = 'https://api.github.com/graphql';

const PR_QUERY = `
query PRs($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id number title url updatedAt createdAt mergedAt isDraft state reviewDecision
        additions deletions
        author { login avatarUrl }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name color } }
        comments { totalCount }
        reviews  { totalCount }
        commits(last: 1) {
          nodes { commit { oid statusCheckRollup { state } } }
        }
      }
    }
  }
}`;

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

function scopeAxes(cfg, userLogin) {
  const axes = [];
  if (cfg.includeInvolves && userLogin) axes.push(`involves:${userLogin}`);
  for (const r of cfg.watchRepos || []) axes.push(`repo:${r}`);
  for (const o of cfg.watchOrgs || []) axes.push(`org:${o}`);
  for (const u of cfg.watchUsers || []) axes.push(`user:${u}`);
  return axes;
}

function buildQueries(cfg, userLogin) {
  const axes = scopeAxes(cfg, userLogin);
  const since = isoDaysAgo(90);
  return axes.map((axis) => `${BASE_OPEN} ${axis} created:>=${since}`);
}

function buildMergedQueries(cfg, userLogin, sinceDate) {
  const axes = scopeAxes(cfg, userLogin);
  const since = sinceDate || isoDaysAgo(7);
  return axes.map((axis) => `${BASE_MERGED} ${axis} merged:>=${since}`);
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function appError(kind, message, extra = {}) {
  const e = new Error(message);
  e.kind = kind;
  Object.assign(e, extra);
  return e;
}

export async function runQuery(query, variables, token) {
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
  return { data: json.data, errors: json.errors || [] };
}

export async function fetchViewerLogin(token) {
  const { data } = await runQuery(VIEWER_QUERY, {}, token);
  return data?.viewer?.login || null;
}

export async function fetchViewerAndOrgs(token) {
  const { data } = await runQuery(VIEWER_ORGS_QUERY, {}, token);
  const v = data?.viewer;
  if (!v) return { user: null, orgs: [] };
  return {
    user: { login: v.login, avatarUrl: v.avatarUrl, kind: 'user' },
    orgs: (v.organizations?.nodes || []).map((o) => ({
      login: o.login,
      name: o.name || o.login,
      avatarUrl: o.avatarUrl,
      kind: 'org',
    })),
  };
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

async function paginate(q, token, onPartial) {
  const nodes = [];
  let cursor = null;
  let issueCount = 0;
  for (let page = 0; page < 20; page++) {
    const { data, errors } = await runQuery(PR_QUERY, { q, cursor }, token);
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

export async function fanoutFetch(cfg, userLogin, token, onPartial) {
  const openQs = buildQueries(cfg, userLogin);
  const mergedQs = buildMergedQueries(cfg, userLogin);
  if (openQs.length === 0 && mergedQs.length === 0) {
    return { prs: [], capped: [], empty: true };
  }
  const allQueries = [...openQs, ...mergedQs];
  const results = await Promise.all(allQueries.map((q) => paginate(q, token, onPartial)));
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
