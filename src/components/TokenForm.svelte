<script>
  import { tokenStore } from '../lib/stores.js';
  import { loadAccount } from '../lib/account.js';

  export let onSaved = () => {};
  export let submitLabel = 'Connect';
  export let showHelp = true;

  // Pre-filled token forms. Fine-grained links can't preselect repositories;
  // classic ones take scopes only.
  const FINE_GRAINED_URL =
    'https://github.com/settings/personal-access-tokens/new?name=prdeck' +
    '&description=Read-only+token+for+prdeck&expires_in=90' +
    '&pull_requests=read&contents=read&statuses=read';
  const CLASSIC_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:org&description=prdeck';

  let token = '';
  let saving = false;
  let error = '';

  // Checked against GitHub before it replaces the saved token, so a typo
  // doesn't knock out a working setup.
  async function save() {
    const t = token.trim();
    if (!t || saving) return;
    saving = true;
    error = '';
    try {
      await loadAccount(t);
      tokenStore.set(t);
      token = '';
      onSaved(t);
    } catch (e) {
      error = e.kind === 'auth' ? 'GitHub rejected this token.' : e.message || 'Could not reach GitHub.';
    } finally {
      saving = false;
    }
  }
</script>

<form class="token-form" on:submit|preventDefault={save}>
  <label for="token-input">Personal access token</label>
  <div class="row">
    <input
      id="token-input"
      type="password"
      placeholder="github_pat_… or ghp_…"
      autocomplete="off"
      bind:value={token}
      disabled={saving} />
    <button type="submit" class="primary" disabled={saving || !token.trim()}>
      {saving ? 'Checking…' : submitLabel}
    </button>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</form>

{#if showHelp}
  <div class="help">
    <p class="lead">Don't have one? Create it on GitHub. The form opens filled in.</p>
    <div class="opt">
      <a href={FINE_GRAINED_URL} target="_blank" rel="noopener noreferrer">Fine-grained token, read-only ↗</a>
      <span>Safest. Works for public repos anywhere and private repos of one owner. Can't list your orgs, so prdeck finds them from your PRs.</span>
    </div>
    <div class="opt">
      <a href={CLASSIC_URL} target="_blank" rel="noopener noreferrer">Classic token (repo, read:org) ↗</a>
      <span>For private repos across several orgs. Also allows writes, so pick a short expiry. If your org uses single sign-on, click <em>Configure SSO</em> next to the token afterwards.</span>
    </div>
  </div>
{/if}

<style>
  .token-form { display: flex; flex-direction: column; gap: 8px; }
  label { font-size: 13px; font-weight: 600; }
  .row { display: flex; gap: 8px; }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 7px 10px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
  }
  button.primary {
    font: inherit;
    font-weight: 600;
    padding: 7px 16px;
    border: 1px solid #1f883d;
    background: #1f883d;
    color: #fff;
    border-radius: 6px;
    cursor: pointer;
  }
  button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
  .err { margin: 0; color: #cf222e; font-size: 13px; }
  .help {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
    padding: 12px;
    background: #f6f8fa;
    border: 1px solid #d8dee4;
    border-radius: 6px;
    font-size: 13px;
  }
  .lead { margin: 0; font-weight: 600; }
  .opt { display: flex; flex-direction: column; gap: 3px; }
  .opt a { font-weight: 600; color: #0969da; }
  .opt span { color: #57606a; }
</style>
