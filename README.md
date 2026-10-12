# prdeck

A local dashboard for keeping track of GitHub pull requests across the repos and orgs you care about.

The whole app is a single HTML file. Build it once, drop it somewhere on your disk, bookmark `file:///path/to/index.html`, and that is your install. No server, no backend, no telemetry, no account. The personal access token sits in `localStorage` and the PR cache lives in IndexedDB, both scoped to that file URL in your browser.

## Build the file

```bash
npm install
npm run build
```

That produces `dist/index.html`. Put it anywhere you like (`~/Tools/pr-review/index.html`, your Dropbox, a USB stick, whatever) and open it in a browser. Bookmark the page. Done.

When a new version comes out, replace the file in place. The cache and token are tied to the file's URL, so as long as you keep it at the same path, your data carries over.

## Develop

If you want to hack on it:

```bash
npm run dev           # http://localhost:5173
```

## Setup

The left sidebar walks you through three steps.

1. **Token.** Paste a fine-grained GitHub personal access token with `repo:read` and `pull-requests:read`.
2. **Owners.** Pick yourself and any orgs whose PRs you want to see.
3. **Repos.** Pick the specific repos. You can also tick "Also: PRs involving me" to include anything that mentions you anywhere.

## Tabs

At the top of the list are two tabs.

- **opened.** Open PRs in your scope. The badge shows how many are new or have changed since you last looked at them.
- **recently merged.** PRs merged in the last 7 days (configurable in **Advanced**). The badge shows how many merged without you ever clicking through them.

## Status

Every PR is one of three states.

- **NEW.** First time you are seeing it in this session, or it merged while you were away without you having reviewed it.
- **UPDATED.** An open PR whose head commit or update time has moved since the last time you opened it.
- **SEEN.** Everything else.

Clicking a NEW or UPDATED title marks it seen automatically. Clicking the round arrow in the row resets a PR to NEW.

A merged PR never shows UPDATED. Once you have clicked through it, it stays SEEN.

When you first set up the app the list is calm: every PR already in scope reads as SEEN. Activity that happens after that point shows up as NEW.

## Search

The search box at the top of the list uses GitHub-style `field:value` syntax. Type into it to get an autocomplete dropdown. Arrow keys to navigate, Enter or Tab to insert.

```
fix flaky repo:~hyperfleet -author:~bot -is:draft review:approved
```

Plain words match the PR title (case-insensitive substring), so `fix flaky` keeps PRs whose title contains both words. Quote a phrase to match it as one piece: `"fix flaky"`.

| field      | accepted values                                                  |
|------------|------------------------------------------------------------------|
| `title:`   | substring match, case-insensitive. `"quoted phrases"` allowed.    |
| `author:`  | GitHub login                                                     |
| `repo:`    | `owner/name`                                                     |
| `label:`   | label name                                                       |
| `status:`  | `new`, `updated`, `seen`                                         |
| `review:`  | `approved`, `changes-requested`, `review-required`, `none`       |
| `ci:`      | `success`, `failure`, `pending`, `error`, `none` (needs **Track CI status**) |
| `is:`      | `draft`                                                          |

`author:`, `repo:` and `label:` match the whole value. Put `~` after the colon to match a substring instead: `repo:~hyperfleet`, `label:~"ok-to"`, `-author:~bot`.

Prefix any token with `-` to negate it (`-author:dependabot`, `-is:draft`, `-wip`). Multiple tokens are AND-ed together. There is no `OR`.

PRs hidden by the search show up in a collapsible "N hidden" section under the list, with the reason they were hidden printed above each row.

## Refreshing

The app refreshes on a timer (default every 5 minutes). The timer keeps running while the tab is in the background, so the list is current when you come back. Once the tab has been hidden for longer than the pause setting (default 2 hours), background refreshes stop until you look at the tab again. Your activity in other tabs and apps is invisible to the page, so "away" means "hasn't looked at prdeck".

It also refreshes when you open the page or bring the tab back, if the last refresh is more than a minute old, and when the network comes back online.

There are two kinds of refresh.

- **Full sync.** Fetches every PR in scope from scratch. Runs on first load, when you change the scope or the time windows, when the last full sync is more than an hour old, and when you shift-click `↻ Refresh`.
- **Incremental sync.** Everything else. For each scope it asks only for PRs updated since the last sync (with a 5 minute overlap) and merges them into the cache. CI results don't change a PR's update time, so open PRs whose CI was still running are also refetched directly by ID. Cost grows with how much changed, not with how many PRs you follow.

### Advanced settings

| setting | default | meaning |
|---|---|---|
| Track CI status | on | Off skips the CI field everywhere: faster queries, no CI badge, no `ci:` search, no by-ID refetch. |
| Refresh interval | 5 min | How often the timer fires. |
| Pause refresh after tab hidden for | 2 h | `0` keeps refreshing forever. |
| Open PRs created in last | 90 days | `0` means no limit. Open PRs older than this are not shown. |
| Merged PRs from last | 7 days | Window for the **recently merged** tab. |

## Project layout

```
src/
  App.svelte             Top-level layout, refresh scheduler, viewed/unseen handlers.
  components/
    Sidebar.svelte       Token, Owners, Repos, Advanced sections.
    Filters.svelte       Search input, autocomplete, sort, excluded chips.
    PRList.svelte        Tabs, list rendering, hidden-rows section.
    PRRow.svelte         A single PR row.
    ErrorBanner.svelte   Error and rate-limit banner.
  lib/
    github.js            GraphQL fetch. Full sync: one query per scope for open
                         PRs plus one for recent merges. Incremental sync: one
                         updated-since query per scope plus a by-id refetch of
                         PRs with CI still running.
    cache.js             IndexedDB stores: prs, viewed, observed, etags, meta
                         (meta.sync holds the incremental-sync watermark).
    status.js            classify(pr, viewed, observed, lastDismissedAt) returning
                         NEW / UPDATED / SEEN. Plus hasToken, hasScope, default
                         filter shape.
    query.js             Tokenizer, matcher, and autocomplete context for the
                         search syntax.
    stores.js            Svelte stores. Persisted to localStorage: token,
                         settings, filters, sort, sidebar collapse, view mode,
                         owner and repo caches.
```

## Notes

- The token sits in `localStorage` under `prdeck.pat`. Use a fine-grained token. Click *edit* in the Token section to rotate it.
- Filters are pure client-side. Changing a filter does not refetch.
- GitHub's search API caps results at 1000 per query. If you hit that cap a banner says so.
