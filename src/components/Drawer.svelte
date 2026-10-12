<script>
  import { onMount, onDestroy, tick } from 'svelte';

  export let title = '';
  export let onClose = () => {};

  let panel;
  let returnFocus;

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }

  onMount(async () => {
    returnFocus = document.activeElement;
    await tick();
    panel?.querySelector('input, select, button:not(.close), a[href]')?.focus();
  });

  onDestroy(() => {
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  });
</script>

<svelte:window on:keydown={onKeydown} />

<!-- Esc closes the panel from the keyboard; the backdrop is a mouse shortcut. -->
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="backdrop" on:click={onClose} aria-hidden="true"></div>
<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" bind:this={panel}>
  <div class="head">
    <h2 id="drawer-title">{title}</h2>
    <button type="button" class="close" aria-label="Close" on:click={onClose}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="body"><slot /></div>
  {#if $$slots.footer}
    <div class="foot"><slot name="footer" /></div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(31, 35, 40, 0.3);
    z-index: 40;
  }
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(520px, 100vw);
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid #d0d7de;
    box-shadow: -8px 0 24px rgba(140, 149, 159, 0.2);
    z-index: 41;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    border-bottom: 1px solid #d0d7de;
  }
  h2 {
    margin: 0;
    flex: 1;
    font-size: 16px;
    font-weight: 600;
  }
  .close {
    display: inline-flex;
    padding: 6px;
    border: none;
    background: none;
    color: #57606a;
    border-radius: 6px;
    cursor: pointer;
  }
  .close:hover { background: #f3f4f6; color: #1f2328; }
  .body {
    flex: 1;
    overflow-y: auto;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-top: 1px solid #d0d7de;
    background: #f6f8fa;
    font-size: 12px;
    color: #57606a;
  }
</style>
