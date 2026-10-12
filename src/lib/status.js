export const STATUS = {
  NEW: 'NEW',
  UPDATED: 'UPDATED',
  SEEN: 'SEEN',
};

export const STATE = {
  OPEN: 'OPEN',
  MERGED: 'MERGED',
  CLOSED: 'CLOSED',
};

// Merged PRs don't surface UPDATED — once you've seen one, a later commit
// landing in the same merge doesn't matter. Open PRs care about drift past
// the last viewed head/updatedAt.
export function classify(pr, viewed, observed, lastDismissedAt) {
  const isMerged = pr.state === STATE.MERGED;
  const v = viewed.get(pr.id);
  if (v) {
    if (isMerged) return STATUS.SEEN;
    if (v.viewedHeadSha !== pr.headSha || v.viewedUpdatedAt !== pr.updatedAt) {
      return STATUS.UPDATED;
    }
    return STATUS.SEEN;
  }
  const obs = observed.get(pr.id);
  if (obs && (obs.firstSeenAt || 0) <= (lastDismissedAt || 0)) {
    const updTime = new Date(pr.updatedAt).getTime();
    if (updTime > (lastDismissedAt || 0)) return STATUS.UPDATED;
    return STATUS.SEEN;
  }
  return STATUS.NEW;
}

export function annotate(prs, viewed, observed, lastDismissedAt) {
  return prs.map((pr) => ({
    ...pr,
    status: classify(pr, viewed, observed, lastDismissedAt),
  }));
}

export function hasToken(token) {
  return !!(token && String(token).trim());
}

export function hasScope(settings) {
  if (!settings) return false;
  if (settings.includeInvolves) return true;
  return (
    (settings.watchRepos?.length || 0) > 0 ||
    (settings.watchOrgs?.length || 0) > 0 ||
    (settings.watchUsers?.length || 0) > 0
  );
}
