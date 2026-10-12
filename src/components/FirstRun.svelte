<script>
  import { onMount } from 'svelte';
  import TokenForm from './TokenForm.svelte';
  import RepoPicker from './RepoPicker.svelte';
  import { settingsStore, tokenStore, accountStore } from '../lib/stores.js';
  import { ensureAccount, describeAccount } from '../lib/account.js';
  import { hasToken as tokenPresent } from '../lib/status.js';

  export let onDone = () => {};

  const SUGGESTED = 5;

  let replacing = false;
  let loading = false;
  let loadError = '';

  $: connected = tokenPresent($tokenStore) && !replacing;
  $: account = $accountStore;
  $: repos = $settingsStore.watchRepos || [];
  $: suggestions = (account?.repos || []).slice(0, SUGGESTED);
  // Repos added through the picker that aren't among the suggestions.
  $: extra = repos.filter((r) => !suggestions.some((s) => s.nameWithOwner === r));
  $: canStart = connected && !!account?.user && ($settingsStore.includeInvolves || repos.length > 0);

  async function refreshAccount() {
    if (!tokenPresent($tokenStore)) return;
    loading = true;
    loadError = '';
    try {
      await ensureAccount($tokenStore);
    } catch (e) {
      loadError = e.kind === 'auth' ? 'GitHub rejected the saved token. Connect a new one.' : e.message || 'Could not reach GitHub.';
    } finally {
      loading = false;
    }
  }

  function toggleRepo(name) {
    settingsStore.update((s) => {
      const list = s.watchRepos || [];
      return { ...s, watchRepos: list.includes(name) ? list.filter((x) => x !== name) : [...list, name] };
    });
  }

  function addRepo(name) {
    settingsStore.update((s) => ({ ...s, watchRepos: [...new Set([...(s.watchRepos || []), name])] }));
  }

  function start() {
    settingsStore.update((s) => ({ ...s, setupDone: true }));
    onDone();
  }

  onMount(refreshAccount);
</script>

<div class="first-run">
  <header class="bar">
    <span class="brand">prdeck</span>
    <span class="sub">Setup</span>
  </header>

  <main>
    <div class="intro">
      <h1>Set up prdeck</h1>
      <p>Two steps. Your token stays in this browser and is only ever sent to api.github.com.</p>
    </div>

    <div class="steps">
      <section class="card">
        <div class="step-head">
          <span class="num" class:done={connected}>
            {#if connected}
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            {:else}1{/if}
          </span>
          <h2>Connect GitHub</h2>
        </div>
        {#if connected}
          <p class="ok">
            {#if account?.user}Connected as <strong>{describeAccount(account)}</strong>{:else if loading}Checking your token…{:else}Token saved.{/if}
          </p>
          {#if loadError}<p class="err" role="alert">{loadError}</p>{/if}
          <button type="button" class="link" on:click={() => (replacing = true)}>Use a different token</button>
        {:else}
          <TokenForm onSaved={() => (replacing = false)} />
          {#if replacing}<button type="button" class="link" on:click={() => (replacing = false)}>Keep the current token</button>{/if}
        {/if}
      </section>

      <section class="card" class:disabled={!connected}>
        <div class="step-head">
          <span class="num">2</span>
          <h2>Choose what to track</h2>
        </div>

        {#if !connected}
          <p class="muted">Connect GitHub first.</p>
        {:else}
          <label class="involves">
            <input
              type="checkbox"
              checked={$settingsStore.includeInvolves}
              on:change={(e) => settingsStore.update((s) => ({ ...s, includeInvolves: e.currentTarget.checked }))} />
            <span>
              <span class="strong">PRs involving you <span class="rec">recommended</span></span>
              <span class="desc">Ones you opened, review, are assigned to or are mentioned in, in any repo.</span>
            </span>
          </label>

          <div class="repos">
            <div class="strong">Also every PR in these repos <span class="muted">(optional)</span></div>
            {#if loading && suggestions.length === 0}
              <p class="muted">Looking at your recent PRs…</p>
            {:else if suggestions.length > 0}
              <p class="muted small">Suggested from your recent PRs:</p>
            {/if}
            {#each suggestions as r (r.nameWithOwner)}
              <label class="repo">
                <input type="checkbox" checked={repos.includes(r.nameWithOwner)} on:change={() => toggleRepo(r.nameWithOwner)} />
                <span class="mono">{r.nameWithOwner}</span>
                <span class="meta">{r.prs} of your PRs</span>
              </label>
            {/each}
            {#each extra as name (name)}
              <label class="repo">
                <input type="checkbox" checked on:change={() => toggleRepo(name)} />
                <span class="mono">{name}</span>
              </label>
            {/each}
            <RepoPicker selected={repos} onAdd={addRepo} inputId="first-run-repo" placeholder="Find another repo: owner/name or a word" />
          </div>

          <div class="start">
            <button type="button" class="primary" disabled={!canStart} on:click={start}>Start tracking</button>
            <span class="muted small">Change it any time from <strong>Tracking</strong> in the header. Whole orgs live there too.</span>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>

<style>
  .first-run { min-height: 100vh; display: flex; flex-direction: column; }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    background: #fff;
    border-bottom: 1px solid #d0d7de;
  }
  .brand { font-weight: 700; font-size: 16px; }
  .sub { font-size: 12px; color: #57606a; }
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 40px 16px;
  }
  .intro { text-align: center; display: flex; flex-direction: column; gap: 6px; }
  h1 { margin: 0; font-size: 24px; font-weight: 600; }
  .intro p { margin: 0; color: #57606a; }
  .steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 24px;
    width: 100%;
    max-width: 1080px;
    align-items: start;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    background: #fff;
    border: 1px solid #d0d7de;
    border-radius: 8px;
  }
  .card.disabled { opacity: 0.6; }
  .step-head { display: flex; align-items: center; gap: 10px; }
  .step-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #0969da;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .num.done { background: #1a7f37; }
  .ok { margin: 0; font-size: 13px; color: #1a7f37; }
  .err { margin: 0; color: #cf222e; font-size: 13px; }
  .muted { color: #57606a; margin: 0; }
  .small { font-size: 12px; }
  .strong { font-weight: 600; font-size: 13px; }
  .involves {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px;
    border: 1px solid #54aeff;
    background: #ddf4ff;
    border-radius: 6px;
    cursor: pointer;
  }
  .involves input { margin-top: 3px; }
  .involves > span { display: flex; flex-direction: column; gap: 2px; }
  .involves .strong { font-size: 14px; }
  .rec { font-weight: 500; font-size: 12px; color: #0550ae; }
  .desc { font-size: 13px; color: #424a53; }
  .repos { display: flex; flex-direction: column; gap: 6px; }
  .repo {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  .mono { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  .meta { margin-left: auto; font-size: 12px; color: #57606a; white-space: nowrap; }
  .start { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  button.primary {
    font: inherit;
    font-weight: 600;
    padding: 8px 16px;
    border: 1px solid #1f883d;
    background: #1f883d;
    color: #fff;
    border-radius: 6px;
    cursor: pointer;
  }
  button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
  button.link {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: #0969da;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button.link:hover { text-decoration: underline; }
</style>
