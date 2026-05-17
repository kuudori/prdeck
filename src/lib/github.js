const ENDPOINT = 'https://api.github.com/graphql';

const PR_QUERY = `
query PRs($q: String!, $cursor: String) {
  rateLimit { remaining resetAt cost }
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id number title url updatedAt isDraft reviewDecision
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

const BASE = 'is:pr is:open archived:false';

export function buildQueries(cfg, userLogin) {
  const axes = [];
  if (cfg.includeInvolves && userLogin) axes.push(`involves:${userLogin}`);
  for (const r of cfg.watchRepos || []) axes.push(`repo:${r}`);
  for (const o of cfg.watchOrgs || []) axes.push(`org:${o}`);
  if (axes.length === 0) return [];

  const exclude = (cfg.excludeRepos || []).map((r) => `-repo:${r}`).join(' ');
  const extra = (cfg.extraClauses ?? '').trim();
  return axes.map((axis) => [BASE, axis, exclude, extra].filter(Boolean).join(' '));
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

async function paginate(q, token, onPartial) {
  const nodes = [];
  let cursor = null;
  let issueCount = 0;
  let rateLimit = null;
  for (let page = 0; page < 20; page++) {
    const { data, errors } = await runQuery(PR_QUERY, { q, cursor }, token);
    if (errors.length && onPartial) onPartial({ query: q, errors });
    issueCount = data.search.issueCount;
    rateLimit = data.rateLimit;
    for (const n of data.search.nodes) {
      if (n && n.id) nodes.push(n);
    }
    if (!data.search.pageInfo.hasNextPage) break;
    cursor = data.search.pageInfo.endCursor;
  }
  return { query: q, nodes, rateLimit, capHit: issueCount > 1000, issueCount };
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
  const queries = buildQueries(cfg, userLogin);
  if (queries.length === 0) {
    return { prs: [], capped: [], rateLimit: null, empty: true };
  }
  const results = await Promise.all(queries.map((q) => paginate(q, token, onPartial)));
  const byId = new Map();
  const capped = [];
  for (const r of results) {
    if (r.capHit) capped.push(r.query);
    for (const node of r.nodes) byId.set(node.id, node);
  }
  return {
    prs: [...byId.values()].map(normalizePR),
    capped,
    rateLimit: results.at(-1).rateLimit,
    empty: false,
  };
}
