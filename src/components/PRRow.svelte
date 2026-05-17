<script>
  export let pr;
  export let onMarkViewed = () => {};

  const CI_LABEL = {
    SUCCESS: '✓',
    FAILURE: '✗',
    PENDING: '·',
    ERROR: '!',
    EXPECTED: '·',
    NONE: '—',
  };
  const CI_TITLE = {
    SUCCESS: 'Checks passing',
    FAILURE: 'Checks failing',
    PENDING: 'Checks pending',
    ERROR: 'Check errored',
    EXPECTED: 'Checks expected',
    NONE: 'No checks',
  };
  const REVIEW_LABEL = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes requested',
    REVIEW_REQUIRED: 'review required',
    NONE: '',
  };

  function ago(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    return `${d}d`;
  }
</script>

<article class="row status-{pr.status} ci-{pr.ciState}">
  <div class="status-badge">
    {#if pr.status === 'NEW'}<span class="badge new">NEW</span>{/if}
    {#if pr.status === 'UPDATED'}<span class="badge updated">UPDATED</span>{/if}
  </div>

  <div class="ci" title={CI_TITLE[pr.ciState] || pr.ciState}>{CI_LABEL[pr.ciState] || '?'}</div>

  <div class="main">
    <div class="title">
      <a href={pr.url} target="_blank" rel="noopener noreferrer">{pr.title}</a>
      {#if pr.isDraft}<span class="draft">draft</span>{/if}
    </div>
    <div class="meta">
      <span class="repo">{pr.repo}#{pr.number}</span>
      <span class="author">@{pr.author}</span>
      <span class="time">{ago(pr.updatedAt)}</span>
      {#if pr.commentCount > 0}<span class="comments">💬 {pr.commentCount}</span>{/if}
      {#if pr.reviewDecision && pr.reviewDecision !== 'NONE'}
        <span class="review review-{pr.reviewDecision}">{REVIEW_LABEL[pr.reviewDecision]}</span>
      {/if}
      {#each pr.labels as l}
        <span class="label" style="background:#{l.color || '888'}">{l.name}</span>
      {/each}
    </div>
  </div>

  <div class="actions">
    {#if pr.status !== 'SEEN'}
      <button type="button" on:click={() => onMarkViewed(pr)}>Mark viewed</button>
    {/if}
  </div>
</article>

<style>
  .row {
    display: grid;
    grid-template-columns: 5rem 2rem 1fr auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #eee;
  }
  .row:hover {
    background: #fafafa;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .badge.new {
    background: #0969da;
    color: white;
  }
  .badge.updated {
    background: #d97706;
    color: white;
  }
  .ci {
    font-family: ui-monospace, monospace;
    font-weight: 700;
    text-align: center;
    width: 2rem;
  }
  .ci-SUCCESS .ci {
    color: #1a7f37;
  }
  .ci-FAILURE .ci,
  .ci-ERROR .ci {
    color: #cf222e;
  }
  .ci-PENDING .ci,
  .ci-EXPECTED .ci {
    color: #bf8700;
  }
  .ci-NONE .ci {
    color: #999;
  }
  .title {
    font-size: 0.95rem;
  }
  .title a {
    color: #0969da;
    text-decoration: none;
  }
  .title a:hover {
    text-decoration: underline;
  }
  .draft {
    display: inline-block;
    margin-left: 0.4rem;
    font-size: 0.7rem;
    padding: 1px 5px;
    border: 1px solid #888;
    border-radius: 3px;
    color: #555;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: #555;
    margin-top: 0.2rem;
    align-items: center;
  }
  .repo {
    font-family: ui-monospace, monospace;
  }
  .review {
    font-weight: 600;
  }
  .review-APPROVED {
    color: #1a7f37;
  }
  .review-CHANGES_REQUESTED {
    color: #cf222e;
  }
  .review-REVIEW_REQUIRED {
    color: #bf8700;
  }
  .label {
    color: white;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.7rem;
  }
  .actions button {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border: 1px solid #ccc;
    background: white;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
