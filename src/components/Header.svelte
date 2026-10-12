<script>
  import { onDestroy } from 'svelte';

  export let scopeSummary = '';
  // { tone: 'ok'|'busy'|'muted'|'warn'|'danger', text, action?: 'settings' }
  export let status = { tone: 'muted', text: '' };
  export let updateAvailable = false;
  export let watchedCount = 0;
  export let watchingActive = false;
  export let refreshing = false;
  export let canRefresh = true;
  export let onToggleWatching = () => {};
  export let onRefresh = () => {};
  export let onFullResync = () => {};
  export let onOpenScope = () => {};
  export let onOpenSettings = () => {};
  export let onStatusAction = () => {};

  let menuOpen = false;
  let menuEl;

  function closeOnOutside(e) {
    if (menuOpen && menuEl && !menuEl.contains(e.target)) menuOpen = false;
  }
  function onKeydown(e) {
    if (e.key === 'Escape' && menuOpen) menuOpen = false;
  }
  function choose(fn) {
    menuOpen = false;
    fn();
  }
  onDestroy(() => (menuOpen = false));
</script>

<svelte:window on:click={closeOnOutside} on:keydown={onKeydown} />

<header>
  <span class="brand">prdeck</span>
  <button type="button" class="scope" aria-haspopup="dialog" on:click={onOpenScope}>
    <span class="muted">Tracking</span>
    <span class="strong">{scopeSummary}</span>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </button>

  <div class="right">
    {#if status.action}
      <button type="button" class="status tone-{status.tone} as-button" on:click={() => onStatusAction(status.action)}>
        <span class="dot"></span>{status.text}
      </button>
    {:else}
      <span class="status tone-{status.tone}" role="status" aria-live="polite"><span class="dot"></span>{status.text}</span>
    {/if}

    {#if updateAvailable}
      <button type="button" class="update" on:click={() => location.reload()} title="A newer version is deployed">New version · reload</button>
    {/if}

    {#if watchedCount > 0}
      <button type="button" class="watching" class:active={watchingActive} aria-pressed={watchingActive} on:click={onToggleWatching}
        title={watchingActive ? 'Show all PRs' : 'Show only belled PRs'}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        Watching {watchedCount}
      </button>
    {/if}

    <div class="split" bind:this={menuEl}>
      <button type="button" class="main" disabled={!canRefresh || refreshing} on:click={onRefresh}>
        <svg class:spinning={refreshing} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
        Refresh
      </button>
      <button type="button" class="more" aria-label="More refresh options" aria-haspopup="menu" aria-expanded={menuOpen}
        disabled={!canRefresh} on:click|stopPropagation={() => (menuOpen = !menuOpen)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {#if menuOpen}
        <div class="menu" role="menu">
          <button type="button" role="menuitem" disabled={refreshing} on:click={() => choose(onRefresh)}>
            <span class="strong">Refresh now</span>
            <span class="muted">Fetches only what changed.</span>
          </button>
          <button type="button" role="menuitem" disabled={refreshing} on:click={() => choose(onFullResync)}>
            <span class="strong">Full resync</span>
            <span class="muted">Refetches everything in scope. Runs on its own every hour.</span>
          </button>
        </div>
      {/if}
    </div>

    <button type="button" class="icon" aria-label="Settings" on:click={onOpenSettings}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>
    </button>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 12px;
    padding: 10px 20px;
    background: #fff;
    border-bottom: 1px solid #d0d7de;
  }
  .brand { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
  .muted { color: #57606a; }
  .strong { font-weight: 600; }
  button { font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.55; }
  .scope {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid #d0d7de;
    background: #f6f8fa;
    border-radius: 6px;
    color: #1f2328;
    max-width: 100%;
  }
  .scope:hover { background: #eef1f4; }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #57606a;
  }
  .status.as-button {
    border: none;
    background: none;
    padding: 4px 6px;
    border-radius: 6px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #8c959f; display: inline-block; flex-shrink: 0; }
  .tone-ok .dot { background: #1a7f37; }
  .tone-busy .dot { background: #0969da; animation: pulse 1s ease-in-out infinite; }
  .tone-warn { color: #7d4e00; }
  .tone-warn .dot { background: #d4a72c; }
  .tone-danger { color: #a40e26; }
  .tone-danger .dot { background: #cf222e; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .update {
    font-size: 12px;
    padding: 5px 10px;
    border: 1px solid #1a7f37;
    background: #fff;
    border-radius: 6px;
    color: #1a7f37;
  }
  .watching {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 5px 9px;
    border: 1px solid #d0d7de;
    background: #fff;
    border-radius: 6px;
    color: #57606a;
  }
  .watching:hover, .watching.active { border-color: #d4a72c; background: #fff8c5; color: #7d4e00; }
  .split {
    position: relative;
    display: inline-flex;
    border: 1px solid #d0d7de;
    border-radius: 6px;
  }
  .split .main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    padding: 5px 10px;
    border: none;
    background: #fff;
    border-radius: 6px 0 0 6px;
    color: #1f2328;
  }
  .split .more {
    display: inline-flex;
    align-items: center;
    padding: 5px 6px;
    border: none;
    border-left: 1px solid #d0d7de;
    background: #fff;
    border-radius: 0 6px 6px 0;
    color: #57606a;
  }
  .split .main:hover:not(:disabled), .split .more:hover:not(:disabled) { background: #f6f8fa; }
  .spinning { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: 280px;
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
    overflow: hidden;
  }
  .menu button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 9px 14px;
    border: none;
    border-bottom: 1px solid #eef0f3;
    background: #fff;
    color: #1f2328;
    font-size: 13px;
  }
  .menu button:last-child { border-bottom: none; }
  .menu button:hover:not(:disabled) { background: #f6f8fa; }
  .menu .muted { font-size: 12px; }
  .icon {
    display: inline-flex;
    align-items: center;
    padding: 6px;
    border: 1px solid #d0d7de;
    background: #fff;
    border-radius: 6px;
    color: #57606a;
  }
  .icon:hover { background: #f6f8fa; color: #1f2328; }
</style>
