<script>
  import Drawer from './Drawer.svelte';
  import TokenForm from './TokenForm.svelte';
  import { settingsStore, accountStore } from '../lib/stores.js';
  import { describeAccount } from '../lib/account.js';
  import { clearAll } from '../lib/cache.js';
  import { notificationsSupported } from '../lib/watch.js';

  export let onClose = () => {};
  // Settings that change what gets fetched (CI) need a resync.
  export let onScopeChange = () => {};
  export let onTokenChange = () => {};
  // Opened from "Token rejected" in the header: start with the token form.
  export let replacingToken = false;

  const INTERVALS = [1, 2, 5, 15, 30];
  const BACKGROUND = [
    { value: 'always', label: 'keep refreshing' },
    { value: '2h', label: 'stop after 2 hours away' },
    { value: '8h', label: 'stop after 8 hours away' },
    { value: 'off', label: 'pause right away' },
  ];
  const BUILD = __BUILD_ID__;
  const CHANGES_URL = 'https://github.com/kuudori/prdeck/commits/main';

  let replacing = replacingToken;
  let permission = notificationsSupported() ? Notification.permission : 'unsupported';

  $: s = $settingsStore;
  $: intervals = INTERVALS.includes(s.intervalMinutes) ? INTERVALS : [...INTERVALS, s.intervalMinutes].sort((a, b) => a - b);

  function update(patch) {
    settingsStore.update((cur) => ({ ...cur, ...patch }));
  }

  async function enableNotifications() {
    try { permission = await Notification.requestPermission(); } catch {}
  }

  function testNotification() {
    new Notification('prdeck', { body: 'Notifications work. Belled PRs will show up like this.' });
  }

  async function clearData() {
    if (!confirm('Clear cached PRs and seen history? Your token, settings and bells are kept.')) return;
    await clearAll();
    location.reload();
  }
</script>

<Drawer title="Settings" {onClose}>
  <section>
    <h3>GitHub token</h3>
    {#if replacing}
      <TokenForm submitLabel="Save" onSaved={() => { replacing = false; onTokenChange(); }} />
      <button type="button" class="link" on:click={() => (replacing = false)}>Keep the current token</button>
    {:else}
      <div class="row">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#1a7f37" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <span class="grow">{describeAccount($accountStore) || 'Token saved'}</span>
        <button type="button" class="secondary" on:click={() => (replacing = true)}>Replace</button>
      </div>
      <p class="note">Stored in this browser only and sent only to api.github.com.</p>
    {/if}
  </section>

  <section>
    <h3>Refreshing</h3>
    <label class="row">
      <span class="grow">Check for changes every</span>
      <select value={s.intervalMinutes} on:change={(e) => update({ intervalMinutes: Number(e.currentTarget.value) })}>
        {#each intervals as m}<option value={m}>{m === 1 ? 'minute' : `${m} minutes`}</option>{/each}
      </select>
    </label>
    <label class="row">
      <span class="grow">While the tab is in the background</span>
      <select value={s.backgroundRefresh} on:change={(e) => update({ backgroundRefresh: e.currentTarget.value })}>
        {#each BACKGROUND as b}<option value={b.value}>{b.label}</option>{/each}
      </select>
    </label>
    <p class="note">Belled PRs are always checked every minute, even when refreshing has stopped.</p>
  </section>

  <section>
    <h3>What to show</h3>
    <label class="check">
      <input
        type="checkbox"
        checked={s.trackCI !== false}
        on:change={(e) => { update({ trackCI: e.currentTarget.checked }); onScopeChange(); }} />
      <span>
        <span class="strong">CI checks</span>
        <span class="note">Show check results on rows and allow <code>ci:</code> in search. Turning it off makes syncing about 4× faster on busy repos.</span>
      </span>
    </label>
  </section>

  <section>
    <h3>Bell notifications</h3>
    <div class="row">
      <span class="grow status">
        <span class="dot" class:ok={permission === 'granted'} class:bad={permission === 'denied'}></span>
        {#if permission === 'granted'}Allowed in this browser
        {:else if permission === 'denied'}Blocked in this browser
        {:else if permission === 'default'}Not allowed yet
        {:else}Not supported in this browser{/if}
      </span>
      {#if permission === 'granted'}
        <button type="button" class="secondary" on:click={testNotification}>Send a test</button>
      {:else if permission === 'default'}
        <button type="button" class="secondary" on:click={enableNotifications}>Allow</button>
      {/if}
    </div>
    <p class="note">
      A belled PR rings on a new push, a review, a CI result and merge or close. Turn the bell on from any row.
      {#if permission === 'denied'}Allow notifications in the browser's site settings; the tab title still shows (n).{/if}
    </p>
  </section>

  <section>
    <h3>Data in this browser</h3>
    <div class="row">
      <span class="grow muted">Cached PRs and seen history. Your token, settings and bells are kept.</span>
      <button type="button" class="secondary danger" on:click={clearData}>Clear</button>
    </div>
  </section>

  <svelte:fragment slot="footer">
    <span>prdeck · build {BUILD.slice(0, 7)} · <a href={CHANGES_URL} target="_blank" rel="noopener noreferrer">What's new</a></span>
  </svelte:fragment>
</Drawer>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 20px;
    border-bottom: 1px solid #eef0f3;
  }
  section:last-child { border-bottom: none; }
  h3 { margin: 0; font-size: 14px; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .grow { flex: 1; }
  .note { margin: 0; font-size: 12px; color: #57606a; }
  .muted { color: #424a53; }
  .strong { font-weight: 600; font-size: 13px; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; cursor: pointer; }
  .check input { margin-top: 2px; }
  .check > span { display: flex; flex-direction: column; gap: 2px; }
  .status { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #8c959f; display: inline-block; }
  .dot.ok { background: #1a7f37; }
  .dot.bad { background: #cf222e; }
  select {
    font: inherit;
    font-size: 13px;
    padding: 5px 8px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    background: #f6f8fa;
  }
  button.secondary {
    font: inherit;
    font-size: 13px;
    padding: 5px 12px;
    border: 1px solid #d0d7de;
    background: #f6f8fa;
    border-radius: 6px;
    color: #1f2328;
    cursor: pointer;
    white-space: nowrap;
  }
  button.secondary:hover { background: #eef1f4; }
  button.danger { color: #cf222e; }
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
  code { font-size: 12px; }
  a { color: #0969da; }
</style>
