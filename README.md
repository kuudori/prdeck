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

The first time you open prdeck it walks you through two steps.

1. **Connect GitHub.** Paste a personal access token. Links under the field open GitHub's token form already filled in, read-only, for either kind of token (see [Token safety](#token-safety)). The token is checked against GitHub before it is saved.
2. **Choose what to track.** "PRs involving you" (opened, reviewed, assigned or mentioning you, in any repo) is on by default. You can also pick repos: the ones behind your recent PRs are suggested with how many of your PRs they hold, and *Find another repo* searches by name across you and your orgs, or takes any `owner/name`.

After that the list takes the whole window. Everything else lives in the header.

## The header

```
prdeck  [Tracking  you · 3 repos · 1 org ▾]        ● Updated 2 min ago  [Watching 1]  [↻ Refresh ▾]  [⚙]
```

- **Tracking** opens the Scope panel: what prdeck tracks.
- **The status** says how current the list is: *Updated 2 min ago*, *Syncing…*, *Paused: tab hidden 3 h*, *Offline: showing PRs from 10:31*, *Rate limited until 10:42*, or *Token rejected · Replace* (click it to replace the token). A *New version · reload* button appears next to it when a newer deploy is live.
- **Watching N** shows only belled PRs (it toggles `is:watched` in the search). It appears once any PR has its bell on.
- **Refresh** fetches what changed. Its menu also has **Full resync**, which refetches everything in scope.
- **⚙** opens Settings.

### Scope panel (Tracking)

- **PRs involving you.** On or off.
- **Repositories.** Every open PR in each. Add with the same picker as in setup.
- **Whole organizations.** Every open PR in every repo of an org. This is a separate, deliberate choice: each tracked org shows how many open PRs it has, with a warning that busy orgs get slow and stop at GitHub's 1,000-result search limit. *Track a whole org* suggests the orgs you work in, or takes any name.
- **How far back.** Open PRs created in the last 30 days, 90 days (default), year, or any time.

Changes apply right away with a full resync.

### Settings panel (⚙)

| setting | default | meaning |
|---|---|---|
| GitHub token | | Shows who you are connected as and what the token can see. *Replace* checks a new token before saving it. |
| Check for changes every | 5 minutes | How often the timer fires. |
| While the tab is in the background | stop after 2 hours away | Or keep refreshing, stop after 8 hours, or pause right away. |
| CI checks | on | Off skips the CI field everywhere: about 4× faster syncs on busy repos, no CI on rows, no `ci:` search, no by-ID refetch. |
| Bell notifications | | Whether the browser allows them, with *Allow* or *Send a test*. |
| Data in this browser | | *Clear* drops cached PRs and seen history; token, settings and bells stay. |

## Tabs

- **Open.** Open PRs in scope, with a count and how many are new or updated.
- **Merged.** PRs merged in the window picked right on the tab (last day, 3, 7 (default), 14 or 30 days), with how many merged without you clicking through them.

## Status

Every PR is one of three states.

- **New.** First time you are seeing it, or it merged while you were away without you having reviewed it. Blue edge and tag.
- **Updated.** An open PR whose head commit or update time has moved since the last time you opened it. Orange edge and tag.
- **Seen.** Everything else. No tag, quieter title.

New and updated PRs always sort above seen ones. Clicking a new or updated title marks it seen. The row buttons (on hover or keyboard focus) are the bell and *Mark seen*, or *Mark new* on a seen PR.

A merged PR never shows Updated. Once you have clicked through it, it stays Seen.

When you first set up the app the list is calm: every PR already in scope reads as Seen. Activity that happens after that point shows up as New.

## Search

The search box uses GitHub-style `field:value` syntax. Type into it to get an autocomplete dropdown; arrow keys to navigate, Enter or Tab to insert. The **?** in the box lists the syntax, and clicking an example adds it to the search. Esc clears the box. Sort is the button next to it.

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
| `ci:`      | `success`, `failure`, `pending`, `error`, `none` (needs **CI checks** on) |
| `is:`      | `draft`, `watched` (bell on)                                     |
| `created:` `updated:` `merged:` | a date, optionally with `>`, `>=`, `<`, `<=`  |

`author:`, `repo:` and `label:` match the whole value. Put `~` after the colon to match a substring instead: `repo:~hyperfleet`, `label:~"ok-to"`, `-author:~bot`.

Prefix any token with `-` to negate it (`-author:dependabot`, `-is:draft`, `-wip`). Multiple tokens are AND-ed together. There is no `OR`.

PRs hidden by the search are counted under the list ("N more hidden by your search") and can be expanded.

## Bell

Hover a row and click the bell to get notified when that PR changes:

- new commits pushed
- review decision changes (approved, changes requested, review required), or a new review
- CI finishes (only with **CI checks** on)
- merged or closed. The bell turns itself off after this.

Comments don't ring the bell; CI bots comment on every re-test. A bell that is on stays visible on its row.

Belled PRs are checked by ID every minute, separately from the main refresh. This check keeps running even when background refreshing has stopped, because being away is when the bell is useful. The first bell click asks for browser notification permission; Settings shows the current permission and a test button. Notifications that fire while the tab is in the background also show as `(n)` in the tab title until you come back, which works even when browser notifications are blocked.

## Refreshing

The app refreshes on a timer (default every 5 minutes). The timer keeps running while the tab is in the background, so the list is current when you come back. Once the tab has been hidden longer than the background setting allows (default 2 hours), refreshing stops and the header says *Paused* until you look at the tab again. Your activity in other tabs and apps is invisible to the page, so "away" means "hasn't looked at prdeck".

It also refreshes when you open the page or bring the tab back, if the last refresh is more than a minute old, and when the network comes back online.

There are two kinds of refresh.

- **Full sync.** Fetches every PR in scope from scratch. Runs on first load, when you change what is tracked or the time windows, when the last full sync is more than an hour old, and from *Full resync* in the refresh menu.
- **Incremental sync.** Everything else. For each scope it asks only for PRs updated since the last sync (with a 5 minute overlap) and merges them into the cache. CI results don't change a PR's update time, so open PRs whose CI was still running are also refetched directly by ID. Cost grows with how much changed, not with how many PRs you follow.

## Project layout

```
src/
  App.svelte             Layout, refresh scheduler, header status, bell polling.
  components/
    FirstRun.svelte      Two-step setup: connect GitHub, choose what to track.
    Header.svelte        Tracking button, status, Watching, refresh menu, settings.
    ScopePanel.svelte    What prdeck tracks: involves-you, repos, whole orgs, age.
    SettingsPanel.svelte Token, refreshing, CI, notifications, local data.
    Drawer.svelte        Side panel shell used by Scope and Settings.
    TokenForm.svelte     Token input (checked before saving) and token help.
    RepoPicker.svelte    Repo combobox: suggestions from your PRs, name search.
    PRList.svelte        Tabs, merged window, list, hidden-by-search section.
    SearchBar.svelte     Search input, autocomplete, syntax help, sort menu.
    PRRow.svelte         A single PR row.
    ErrorBanner.svelte   Errors that aren't shown as header status.
  lib/
    github.js            GraphQL fetch. Full sync: one query per scope for open
                         PRs plus one for recent merges. Incremental sync: one
                         updated-since query per scope plus a by-id refetch of
                         PRs with CI still running. Also token/org/repo lookups.
    account.js           What the token sees (user, orgs, recent repos, token
                         kind), cached for a day.
    cache.js             IndexedDB stores: prs, viewed, observed, etags, meta
                         (meta.sync holds the incremental-sync watermark).
    status.js            classify(pr, viewed, observed, lastDismissedAt) returning
                         NEW / UPDATED / SEEN. Plus hasToken, hasScope.
    query.js             Tokenizer, matcher, and autocomplete context for the
                         search syntax.
    stores.js            Svelte stores. Persisted to localStorage: token,
                         settings, search text, sort, view mode, account cache,
                         belled PRs.
    watch.js             Bell: per-PR snapshots, change detection, notifications.
```

## Notes

- The token sits in `localStorage` under `prdeck.pat`. See [Token safety](#token-safety).
- Search is pure client-side. Changing it does not refetch.
- GitHub's search API caps results at 1000 per query. If you hit that cap a banner says so; tracking specific repos instead of a whole org avoids it.
