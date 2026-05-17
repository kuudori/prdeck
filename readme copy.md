# Reviewbrah

Single-user local GitHub PR dashboard. Pure frontend (no backend) — PAT lives in the browser, PR cache lives in IndexedDB, GraphQL drives the fetch.

## Quick start

```bash
npm install
npm run dev           # http://localhost:5173
```

Then in the app: open **Settings**, paste a fine-grained PAT (scopes: `repo:read`, `pull-requests:read`), and configure scopes — toggle "include PRs involving me" and/or list watched repos/orgs.

## Build a single-file artifact

```bash
npm run build
# → dist/index.html  (self-contained; ~55 KB / 18 KB gzipped)
```

Open `dist/index.html` directly in a browser via `file://` — the full app works offline against cached data.

## What's where

- `src/lib/github.js` — GraphQL fanout. One query per scope axis (search qualifiers don't `OR`), merged by PR id, with the 1000-result Search cap surfaced as a banner.
- `src/lib/cache.js` — IndexedDB stores: `prs`, `viewed`, `observed`, `etags`, `meta`. Versioned via `DB_VERSION`.
- `src/lib/status.js` — Classifier: NEW vs UPDATED vs SEEN. Uses `observed.firstSeenAt` + `meta.lastDismissedAt` to avoid the "NEW forever" bug.
- `src/lib/stores.js` — Svelte stores; persisted-to-localStorage for PAT, settings, filters.
- `src/App.svelte` — Refresh scheduler, visibility/online hooks, mark-viewed flow.

## Status legend

- **NEW** — first observed since you last hit *Catch up*.
- **UPDATED** — head SHA or `updatedAt` differs from what you last viewed.
- **SEEN** — everything else.

## Notes

- PAT is in `localStorage`. Use a fine-grained token. *Forget token* button in Settings clears it.
- Auto-refresh pauses when the tab is hidden; resumes on `visibilitychange` (and refetches if cache is >60s old).
- Filters are pure client-side over the cached list — no refetch on filter change.
