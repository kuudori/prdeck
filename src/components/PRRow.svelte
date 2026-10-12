<script>
  import { STATUS, STATE } from '../lib/status.js';

  export let pr;
  export let onMarkViewed = () => {};
  export let onMarkUnseen = () => {};
  export let onToggleWatch = () => {};

  const REVIEW_LABEL = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes requested',
    REVIEW_REQUIRED: 'review required',
  };

  const CI_LABEL = {
    SUCCESS: '✓ checks passed',
    FAILURE: '✗ checks failed',
    ERROR: '✗ checks failed',
    PENDING: '● checks running',
    EXPECTED: '● checks running',
  };

  function ago(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }

  function fmtNum(n) {
    if (n == null) return '0';
    if (n < 1000) return String(n);
    return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
  }

  function readable(hex) {
    if (!hex || hex.length < 6) return '#fff';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.6 ? '#24292f' : '#fff';
  }

  $: isMerged = pr.state === STATE.MERGED;
  $: isUnseen = pr.status === STATUS.NEW || pr.status === STATUS.UPDATED;
  $: iconColor = isMerged ? '#8250df' : pr.isDraft ? '#57606a' : '#1a7f37';
</script>

<article class="row status-{pr.status}" class:merged={isMerged} class:watched={pr.watched}>
  <div class="icon" title={isMerged ? 'Merged PR' : pr.isDraft ? 'Draft PR' : 'Open PR'} style="color: {iconColor}">
    {#if isMerged}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7"/><path d="M6 8.5c0 2 2 3.5 4.5 3.5h5"/></svg>
    {:else}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7"/><path d="M18 15.5V9a3 3 0 0 0-3-3h-4"/><path d="m13 4-2 2 2 2"/></svg>
    {/if}
  </div>

  <div class="main">
    <div class="title-row">
      <a class="title" href={pr.url} target="_blank" rel="noopener noreferrer"
         on:click={() => { if (isUnseen) onMarkViewed(pr); }}>{pr.title}</a>
      {#each pr.labels || [] as l}
        <span class="gh-label" style="background:#{l.color || '888'}; color:{readable(l.color)}">{l.name}</span>
      {/each}
      {#if pr.isDraft && !isMerged}<span class="tag draft">draft</span>{/if}
      {#if pr.status === STATUS.NEW}<span class="tag new">New</span>
      {:else if pr.status === STATUS.UPDATED}<span class="tag updated">Updated</span>{/if}
    </div>

    <div class="meta">
      <span class="repo">{pr.repo}#{pr.number}</span>
      <span>by @{pr.author}</span>
      {#if isMerged && pr.mergedAt}
        <span>· merged {ago(pr.mergedAt)}</span>
      {:else}
        <span>· updated {ago(pr.updatedAt)}</span>
      {/if}
      <span class="diff"><span class="add">+{fmtNum(pr.additions)}</span> <span class="del">-{fmtNum(pr.deletions)}</span></span>
      {#if CI_LABEL[pr.ciState]}<span class="ci ci-{pr.ciState}">{CI_LABEL[pr.ciState]}</span>{/if}
      {#if REVIEW_LABEL[pr.reviewDecision]}<span class="review review-{pr.reviewDecision}">{REVIEW_LABEL[pr.reviewDecision]}</span>{/if}
    </div>
  </div>

  <div class="right">
    <div class="actions">
      {#if !isMerged || pr.watched}
        <button type="button" class="act bell" class:on={pr.watched} aria-pressed={!!pr.watched}
          aria-label={pr.watched ? 'Stop notifying about this PR' : 'Notify me about this PR'}
          title={pr.watched ? 'Bell on: notifies on push, review, CI, merge' : 'Notify on push, review, CI, merge'}
          on:click={() => onToggleWatch(pr)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill={pr.watched ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none"/></svg>
        </button>
      {/if}
      {#if isUnseen}
        <button type="button" class="act mark seen" on:click={() => onMarkViewed(pr)}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          Mark seen
        </button>
      {:else}
        <button type="button" class="act mark" on:click={() => onMarkUnseen(pr)}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
          Mark new
        </button>
      {/if}
    </div>
    {#if pr.commentCount > 0}
      <span class="comments" title="{pr.commentCount} comments">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        {pr.commentCount}
      </span>
    {/if}
  </div>
</article>

<style>
  .row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid #eef0f3;
    background: #fff;
  }
  .row:hover, .row:focus-within { background: #f6f8fa; }
  .row.status-NEW { box-shadow: inset 3px 0 0 #0969da; }
  .row.status-UPDATED { box-shadow: inset 3px 0 0 #d97706; }
  .row.merged.status-NEW, .row.merged.status-UPDATED { box-shadow: inset 3px 0 0 #8250df; }
  .icon { align-self: start; padding-top: 3px; }
  .main { min-width: 0; }
  .title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .title {
    color: #1f2328;
    text-decoration: none;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .status-SEEN .title { color: #424a53; font-weight: 500; }
  .title:hover { color: #0969da; text-decoration: underline; }
  .tag {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .tag.new { background: #ddf4ff; color: #0550ae; border: 1px solid #54aeff; }
  .tag.updated { background: #fff1e5; color: #953800; border: 1px solid #fb8f44; }
  .merged .tag.new, .merged .tag.updated { background: #fbefff; color: #6639ba; border-color: #c297ff; }
  .tag.draft { background: #f6f8fa; color: #57606a; border: 1px solid #d0d7de; border-radius: 3px; }
  .gh-label {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid rgba(0, 0, 0, 0.08);
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    color: #57606a;
    margin-top: 4px;
    align-items: center;
  }
  .repo { font-family: ui-monospace, monospace; color: #24292f; font-weight: 500; }
  .diff { font-family: ui-monospace, monospace; }
  .add { color: #1a7f37; }
  .del { color: #cf222e; }
  .ci-SUCCESS { color: #1a7f37; }
  .ci-FAILURE, .ci-ERROR { color: #cf222e; }
  .ci-PENDING, .ci-EXPECTED { color: #9a6700; }
  .review { font-weight: 600; }
  .review-APPROVED { color: #1a7f37; }
  .review-CHANGES_REQUESTED { color: #cf222e; }
  .review-REVIEW_REQUIRED { color: #9a6700; }

  .right { display: flex; align-items: center; gap: 10px; color: #57606a; font-size: 13px; min-height: 28px; }
  .comments { display: inline-flex; align-items: center; gap: 3px; }
  .actions { display: flex; gap: 4px; }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: inherit;
    font-size: 12px;
    padding: 4px 9px;
    border: 1px solid #d0d7de;
    background: #fff;
    border-radius: 6px;
    color: #57606a;
    cursor: pointer;
  }
  .act:hover { background: #f3f4f6; color: #1f2328; }
  .act.seen { color: #1a7f37; }
  .act.bell { padding: 5px 7px; }
  .act.bell.on { border-color: #d4a72c; background: #fff8c5; color: #7d4e00; }

  @media (max-width: 600px) {
    .row { grid-template-columns: 22px minmax(0, 1fr); }
    .right { grid-column: 2; }
  }

  /* Calm by default: actions show on hover or keyboard focus. A bell that is
     on stays visible so belled PRs are recognisable at a glance. Touch
     screens have no hover, so they always show. */
  @media (hover: hover) {
    .act { visibility: hidden; }
    .row:hover .act, .row:focus-within .act, .act.bell.on { visibility: visible; }
  }
</style>
