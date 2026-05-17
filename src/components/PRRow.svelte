<script>
  import { STATUS, STATE } from '../lib/status.js';

  export let pr;
  export let onMarkViewed = () => {};
  export let onMarkUnseen = () => {};

  const REVIEW_LABEL = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes requested',
    REVIEW_REQUIRED: 'review required',
  };

  const STATUS_TAG = {
    [STATUS.NEW]: { cls: 'new', text: 'NEW' },
    [STATUS.UPDATED]: { cls: 'updated', text: 'UPDATED' },
    [STATUS.SEEN]: { cls: 'seen', text: 'seen' },
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
  $: prIconColor = isMerged ? '#8250df' : (pr.isDraft ? '#656d76' : '#1a7f37');
  $: needsAttention = pr.reviewDecision === 'CHANGES_REQUESTED' || pr.reviewDecision === 'REVIEW_REQUIRED';
  $: ciGlyph =
    pr.ciState === 'SUCCESS' ? '✓ checks' :
    (pr.ciState === 'FAILURE' || pr.ciState === 'ERROR') ? '✗ checks' :
    (pr.ciState === 'PENDING' || pr.ciState === 'EXPECTED') ? '● checks' : '';
  $: statusTag = STATUS_TAG[pr.status];
  $: isUnseen = pr.status === STATUS.NEW || pr.status === STATUS.UPDATED;
</script>

<article class="row status-{pr.status}" class:merged={isMerged}>
  <div class="icon" title={isMerged ? 'Merged PR' : (pr.isDraft ? 'Draft PR' : 'Open PR')}>
    {#if isMerged}
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill={prIconColor} d="M5 3.254V3.25v.018A.25.25 0 0 1 5 3.254Zm.045-.041a2.25 2.25 0 1 1 1.5 0v1.737c.842-.495 1.7-.747 2.553-.756 1.677-.026 3.135.886 4.066 1.948.31.355.622.74.886 1.115V5.372a2.25 2.25 0 1 1 1.5 0v5.256a2.251 2.251 0 1 1-1.5 0V8.825a8.62 8.62 0 0 0-1.952-2.218c-.715-.516-1.578-.875-2.5-.86-.7.007-1.5.27-2.553.825v3.056a2.251 2.251 0 1 1-1.5 0V5.372ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
      </svg>
    {:else}
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path fill={prIconColor} d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
      </svg>
    {/if}
  </div>

  <div class="main">
    <div class="title-row">
      <a class="title" href={pr.url} target="_blank" rel="noopener noreferrer"
         on:click={() => { if (isUnseen) onMarkViewed(pr); }}>{pr.title}</a>
      {#if needsAttention}
        <span class="dot" title={REVIEW_LABEL[pr.reviewDecision] || 'needs attention'}></span>
      {/if}
      {#if pr.labels?.length}
        {#each pr.labels as l}
          <span class="gh-label" style="background:#{l.color || '888'}; color:{readable(l.color)}">{l.name}</span>
        {/each}
      {/if}
      {#if isMerged}<span class="tag merged-tag">merged</span>
      {:else if pr.isDraft}<span class="tag draft">draft</span>{/if}
      {#if statusTag}<span class="tag {statusTag.cls}">{statusTag.text}</span>{/if}
    </div>

    <div class="meta">
      <span class="repo">{pr.repo}#{pr.number}</span>
      <span>opened {ago(pr.createdAt)} by @{pr.author}</span>
      {#if isMerged && pr.mergedAt}
        <span class="time">· merged {ago(pr.mergedAt)}</span>
      {:else}
        <span class="time">· updated {ago(pr.updatedAt)}</span>
      {/if}
      {#if pr.additions != null || pr.deletions != null}
        <span class="diff">
          <span class="add">+{fmtNum(pr.additions)}</span>
          <span class="del">-{fmtNum(pr.deletions)}</span>
        </span>
      {/if}
      {#if ciGlyph}
        <span class="ci ci-{pr.ciState}" title={pr.ciState}>{ciGlyph}</span>
      {/if}
      {#if REVIEW_LABEL[pr.reviewDecision]}
        <span class="review review-{pr.reviewDecision}">{REVIEW_LABEL[pr.reviewDecision]}</span>
      {/if}
    </div>
  </div>

  <div class="right">
    {#if pr.commentCount > 0}
      <span class="comments" title="comments">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="#656d76" d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.189l2.72-2.719a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
        {pr.commentCount}
      </span>
    {/if}
    <div class="actions">
      {#if isUnseen}
        <button type="button" class="act primary" on:click={() => onMarkViewed(pr)} title="Mark viewed">✓</button>
        <button type="button" class="act" on:click={() => onMarkUnseen(pr)} title="Reset to NEW">↺</button>
      {:else}
        <button type="button" class="act" on:click={() => onMarkUnseen(pr)} title="Mark as unseen">↺</button>
      {/if}
    </div>
  </div>
</article>

<style>
  .row {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    gap: 0.6rem;
    align-items: start;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid #eef0f3;
    background: white;
  }
  .row:hover { background: #f6f8fa; }
  .row.status-NEW { box-shadow: inset 3px 0 0 #0969da; }
  .row.status-UPDATED { box-shadow: inset 3px 0 0 #d97706; }
  .row.status-SEEN { opacity: 0.7; }
  .icon {
    padding-top: 3px;
  }
  .main { min-width: 0; }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .title {
    color: #1f2328;
    text-decoration: none;
    font-size: 0.95rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .title:hover { color: #0969da; text-decoration: underline; }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fb8500;
    display: inline-block;
    flex-shrink: 0;
  }

  .tag {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tag.new { background: #0969da; color: white; }
  .tag.updated { background: #d97706; color: white; }
  .tag.seen { background: #eee; color: #777; }
  .tag.draft { background: #f6f8fa; color: #656d76; border: 1px solid #d0d7de; }
  .tag.merged-tag { background: #8250df; color: white; }
  .row.merged.status-NEW { box-shadow: inset 3px 0 0 #8250df; }
  .row.merged.status-UPDATED { box-shadow: inset 3px 0 0 #8250df; }

  .gh-label {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 500;
    border: 1px solid rgba(0,0,0,0.08);
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: #656d76;
    margin-top: 0.25rem;
    align-items: center;
  }
  .repo {
    font-family: ui-monospace, monospace;
    color: #24292f;
    font-weight: 500;
  }
  .time, .diff, .ci, .review { color: #656d76; }
  .diff { display: inline-flex; gap: 0.25rem; font-family: ui-monospace, monospace; }
  .diff .add { color: #1a7f37; }
  .diff .del { color: #cf222e; }
  .ci-SUCCESS { color: #1a7f37; }
  .ci-FAILURE, .ci-ERROR { color: #cf222e; }
  .ci-PENDING, .ci-EXPECTED { color: #bf8700; }
  .ci-NONE { display: none; }
  .review { font-weight: 600; }
  .review-APPROVED { color: #1a7f37; }
  .review-CHANGES_REQUESTED { color: #cf222e; }
  .review-REVIEW_REQUIRED { color: #bf8700; }

  .right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: #656d76;
    font-size: 0.8rem;
  }
  .comments {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .actions { display: flex; gap: 0.2rem; }
  .actions button.act {
    padding: 0.18rem 0.4rem;
    font-size: 0.85rem;
    border: 1px solid #d0d7de;
    background: white;
    border-radius: 4px;
    cursor: pointer;
  }
  .actions button.act:hover { background: #f6f8fa; }
  .actions button.act.primary { color: #1a7f37; }
</style>
