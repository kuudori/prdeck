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
- **recently merged.** PRs merged in the last 7 days. The badge shows how many merged without you ever clicking through them.

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
title:bugfix author:alice -is:draft review:approved
```

| field      | accepted values                                                  |
|------------|------------------------------------------------------------------|
| `title:`   | substring match, case-insensitive. `"quoted phrases"` allowed.    |
| `author:`  | GitHub login                                                     |
| `repo:`    | `owner/name`                                                     |
| `label:`   | label name                                                       |
| `status:`  | `new`, `updated`, `seen`                                         |
| `review:`  | `approved`, `changes-requested`, `review-required`, `none`       |
| `ci:`      | `success`, `failure`, `pending`, `error`, `none`                 |
| `is:`      | `draft`                                                          |

Prefix any token with `-` to negate it (`-author:dependabot`, `-is:draft`). Multiple tokens are AND-ed together. There is no `OR`.

PRs hidden by the search show up in a collapsible "N hidden" section under the list, with the reason they were hidden printed above each row.

## Refreshing

The app refreshes on a timer (default every 5 minutes, configurable in **Advanced**). It also refreshes when you bring the tab back to the foreground if the cache is more than a minute old, and when the network comes back online.

The manual `↻ Refresh` button in the top right runs an immediate fetch.

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
    github.js            GraphQL fetch. One query per scope for open PRs, plus
                         one per scope for merges in the last 7 days.
    cache.js             IndexedDB stores: prs, viewed, observed, etags, meta.
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
