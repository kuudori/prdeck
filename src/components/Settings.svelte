<script>
  import { settingsStore, tokenStore } from '../lib/stores.js';
  import { clearAll } from '../lib/cache.js';

  export let onSave = () => {};
  export let onCatchUp = () => {};

  let local = JSON.parse(JSON.stringify($settingsStore));
  let watchReposText = local.watchRepos.join('\n');
  let watchOrgsText = local.watchOrgs.join('\n');
  let excludeReposText = local.excludeRepos.join('\n');
  let token = $tokenStore;

  const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
  const ORG_RE = /^[\w.-]+$/;

  $: repoErrors = watchReposText.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !REPO_RE.test(l));
  $: orgErrors = watchOrgsText.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !ORG_RE.test(l));
  $: excludeErrors = excludeReposText.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !REPO_RE.test(l));
  $: hasErrors = repoErrors.length || orgErrors.length || excludeErrors.length;

  function parseLines(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function save() {
    if (hasErrors) return;
    local.watchRepos = parseLines(watchReposText);
    local.watchOrgs = parseLines(watchOrgsText);
    local.excludeRepos = parseLines(excludeReposText);
    local.intervalMinutes = Math.max(1, Number(local.intervalMinutes) || 5);
    settingsStore.set(local);
    tokenStore.set(token.trim());
    onSave();
  }

  function forgetToken() {
    token = '';
    tokenStore.set('');
  }

  async function clearCache() {
    if (!confirm('Clear all cached PRs, viewed history, and observed records?')) return;
    await clearAll();
    location.reload();
  }
</script>

<section class="settings">
  <h2>Settings</h2>

  <label>
    <span>GitHub Personal Access Token</span>
    <input type="password" bind:value={token} placeholder="ghp_… or github_pat_…" autocomplete="off" />
    <small>Fine-grained PAT recommended. Scopes: <code>repo:read</code>, <code>pull-requests:read</code>.</small>
    {#if token}
      <button type="button" on:click={forgetToken}>Forget token</button>
    {/if}
  </label>

  <label class="checkbox">
    <input type="checkbox" bind:checked={local.includeInvolves} />
    Include PRs that involve me
  </label>

  <label>
    <span>Watched repos <em>(one <code>owner/repo</code> per line)</em></span>
    <textarea bind:value={watchReposText} rows="4" placeholder="acme/api&#10;acme/web"></textarea>
    {#if repoErrors.length}
      <small class="err">Invalid: {repoErrors.join(', ')}</small>
    {/if}
  </label>

  <label>
    <span>Watched orgs <em>(one per line)</em></span>
    <textarea bind:value={watchOrgsText} rows="3" placeholder="acme-labs"></textarea>
    {#if orgErrors.length}
      <small class="err">Invalid: {orgErrors.join(', ')}</small>
    {/if}
  </label>

  <label>
    <span>Excluded repos <em>(<code>owner/repo</code> per line)</em></span>
    <textarea bind:value={excludeReposText} rows="3" placeholder="acme/legacy"></textarea>
    {#if excludeErrors.length}
      <small class="err">Invalid: {excludeErrors.join(', ')}</small>
    {/if}
  </label>

  <label>
    <span>Extra query clauses</span>
    <input type="text" bind:value={local.extraClauses} placeholder="label:needs-review" />
  </label>

  <label>
    <span>Refresh interval (minutes)</span>
    <input type="number" min="1" bind:value={local.intervalMinutes} />
  </label>

  <div class="actions">
    <button type="button" on:click={save} disabled={hasErrors}>Save</button>
    <button type="button" on:click={onCatchUp}>Catch up (clear NEW badges)</button>
    <button type="button" class="danger" on:click={clearCache}>Clear cache</button>
  </div>
</section>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fafafa;
  }
  .settings label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
  }
  .settings label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  .settings input[type="text"],
  .settings input[type="password"],
  .settings input[type="number"],
  .settings textarea {
    font: inherit;
    padding: 0.4rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
  }
  .settings textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .settings small {
    color: #666;
    font-size: 0.75rem;
  }
  .settings small.err {
    color: #b00020;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  button {
    padding: 0.4rem 0.8rem;
    border: 1px solid #999;
    background: white;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.danger {
    border-color: #b00020;
    color: #b00020;
  }
</style>
