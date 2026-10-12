# prdeck

A local dashboard for keeping track of GitHub pull requests across the repos and orgs you care about.

The whole app is a single HTML file that talks to the GitHub API straight from your browser. No backend, no telemetry, no account. Your token sits in `localStorage` and the PR cache in IndexedDB, in your browser only.

## Use it

Open **https://kuudori.github.io/prdeck/** and bookmark it.

- **Updates.** Every push to `main` deploys a new version to the same address. Reload to get it. A tab that has been open for a while shows a *New version · reload* button when a newer deploy is live.
- **Your data.** Token, settings, belled PRs and seen history are stored by your browser for that address, so they survive reloads and new versions. They don't follow you to another browser or computer, and clearing site data or using a private window starts you from scratch.

### Run it from a file instead

```bash
npm install
npm run build
```

That produces `dist/index.html`. Put it anywhere and open it in a browser. When a new version comes out, replace the file in place; data is tied to the file's path, so keep it in the same place. One limitation: Chrome doesn't remember the notification permission for `file://` pages, so the bell asks again after every reload.

## Token safety

The page holds a GitHub token, so:

- Use a read-only token with an expiry date. Click *edit* in the Token section to rotate it.
  - **Fine-grained token** (narrowest): it only covers private repos of the single owner it was created for, and it can't list your orgs. Public repos in any org still work: add the org by name in the Owners step.
  - **Classic token** with `repo` and `read:org`: needed for private repos across several orgs. Broader, since classic `repo` also grants write access, so give it a short expiry.
- The page carries a Content-Security-Policy: it runs only its own script (pinned by hash) and can send requests only to `api.github.com`. Injected code can't run, and the token can't be sent anywhere else.
- Every GitHub Pages site under the same account shares one origin (`kuudori.github.io`) and so one `localStorage`. Don't host other pages there that you don't trust.

## Develop

If you want to hack on it:

```bash
npm run dev           # http://localhost:5173
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Setup

The left sidebar walks you through three steps.

1. **Token.** Paste a GitHub personal access token. *Which token?* under the input links to pre-filled, read-only token forms and explains fine-grained vs classic (see [Token safety](#token-safety)).
2. **Owners.** Pick yourself and any orgs whose PRs you want to see. Besides the orgs your token can list, the orgs behind your 100 most recent PRs are offered too ("from your PRs"), so fine-grained tokens get a useful list. If an org is still missing, a hint says why (fine-grained token, missing `read:org` scope, or single sign-on not authorized), and you can type its name into *Add org or user*.
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
| `is:`      | `draft`, `watched` (bell on)                                     |

`author:`, `repo:` and `label:` match the whole value. Put `~` after the colon to match a substring instead: `repo:~hyperfleet`, `label:~"ok-to"`, `-author:~bot`.

Prefix any token with `-` to negate it (`-author:dependabot`, `-is:draft`, `-wip`). Multiple tokens are AND-ed together. There is no `OR`.

PRs hidden by the search show up in a collapsible "N hidden" section under the list, with the reason they were hidden printed above each row.

## Bell

Click the bell on a row to get notified when that PR changes:

- new commits pushed
- review decision changes (approved, changes requested, review required), or a new review
- CI finishes (only with **Track CI status** on)
- merged or closed. The bell turns itself off after this.

Comments don't ring the bell; CI bots comment on every re-test.

Belled PRs are checked by ID every minute, separately from the main refresh. This check keeps running even when the "away" pause has stopped normal refreshes, because being away is when the bell is useful. The first bell click asks for browser notification permission. **Advanced** shows the current permission and a test button. Notifications that fire while the tab is in the background also show as `(n)` in the tab title until you come back, which works even when browser notifications are blocked.

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
                         owner and repo caches, belled PRs.
    watch.js             Bell: per-PR snapshots, change detection, notifications.
```

## Notes

- The token sits in `localStorage` under `prdeck.pat`. See [Token safety](#token-safety).
- Filters are pure client-side. Changing a filter does not refetch.
- GitHub's search API caps results at 1000 per query. If you hit that cap a banner says so.
