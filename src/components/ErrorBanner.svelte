<script>
  import { errorStore, cappedStore } from '../lib/stores.js';

  // Shown as the header status instead (see App.svelte).
  const IN_HEADER = new Set(['auth', 'rateLimit', 'abuse', 'network']);

  function fmtTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString();
  }
</script>

<div class="banners">
  {#each $errorStore.filter((e) => !IN_HEADER.has(e.kind)) as e (e.id)}
    <div class="banner banner-{e.kind}">
      <span class="msg">{e.message}</span>
      {#if e.kind === 'rateLimit' && e.resetAt}
        <span class="detail">resumes at {fmtTime(e.resetAt)}</span>
      {/if}
      {#if e.kind === 'abuse' && e.retryAfterSec}
        <span class="detail">retry in {e.retryAfterSec}s</span>
      {/if}
      {#if !e.sticky}
        <button type="button" on:click={() => errorStore.dismiss(e.id)}>×</button>
      {/if}
    </div>
  {/each}

  {#if $cappedStore.length > 0}
    <div class="banner banner-cap">
      <span class="msg">
        Search returned >1000 results for: <code>{$cappedStore.join(' | ')}</code>. Narrow the scope.
      </span>
    </div>
  {/if}
</div>

<style>
  .banners {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .banner {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }
  .banner-auth,
  .banner-graphql,
  .banner-http,
  .banner-noPat {
    background: #ffe0e0;
    color: #8b0000;
  }
  .banner-rateLimit,
  .banner-abuse,
  .banner-cap,
  .banner-graphqlPartial {
    background: #fff3cd;
    color: #663c00;
  }
  .banner-network,
  .banner-idb,
  .banner-emptyScope {
    background: #e7f0fd;
    color: #003a8c;
  }
  .msg {
    flex: 1;
  }
  .detail {
    font-size: 0.75rem;
    opacity: 0.8;
  }
  button {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
  }
</style>
