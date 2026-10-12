// The bell: per-PR change notifications. A watched PR stores a snapshot of
// the fields worth notifying about; each poll diffs the fresh PR against it.
//
// Comment counts are left out on purpose: CI bots comment on every re-test,
// which would make the bell as noisy as notifying on everything.

export function snapshot(pr) {
  return {
    headSha: pr.headSha,
    state: pr.state,
    reviewDecision: pr.reviewDecision,
    reviewCount: pr.reviewCount,
    ciState: pr.ciState,
  };
}

export function watchEntry(pr) {
  return { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, snap: snapshot(pr) };
}

const REVIEW_EVENT = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  REVIEW_REQUIRED: 'review required',
};

const CI_DONE = { SUCCESS: 'CI passed', FAILURE: 'CI failed', ERROR: 'CI failed' };

export function diffEvents(prev, next) {
  const events = [];
  if (next.state !== prev.state && next.state === 'MERGED') events.push('merged');
  else if (next.state !== prev.state && next.state === 'CLOSED') events.push('closed');
  if (next.headSha && prev.headSha && next.headSha !== prev.headSha) events.push('new commits');
  if (next.reviewDecision !== prev.reviewDecision && REVIEW_EVENT[next.reviewDecision]) {
    events.push(REVIEW_EVENT[next.reviewDecision]);
  } else if ((next.reviewCount || 0) > (prev.reviewCount || 0)) {
    events.push('new review');
  }
  // From NONE is not an event: CI tracking was just switched on, or checks
  // only appeared after a push (already reported as new commits).
  if (prev.ciState && prev.ciState !== 'NONE' && next.ciState !== prev.ciState && CI_DONE[next.ciState]) {
    events.push(CI_DONE[next.ciState]);
  }
  return events;
}

export function isFinal(pr) {
  return pr.state === 'MERGED' || pr.state === 'CLOSED';
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function showNotification(entry, events) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const n = new Notification(`${entry.repo}#${entry.number}: ${events.join(', ')}`, {
    body: entry.title,
    tag: `${entry.repo}#${entry.number}`,
  });
  n.onclick = () => {
    window.focus();
    window.open(entry.url, '_blank', 'noopener');
    n.close();
  };
}
