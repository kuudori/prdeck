export function classify(pr, viewed, observed, lastDismissedAt) {
  const obs = observed.get(pr.id);
  if (!obs) return 'NEW';
  if ((obs.firstSeenAt || 0) > (lastDismissedAt || 0)) return 'NEW';

  const v = viewed.get(pr.id);
  if (!v) return 'SEEN';
  if (v.viewedHeadSha !== pr.headSha) return 'UPDATED';
  if (v.viewedUpdatedAt !== pr.updatedAt) return 'UPDATED';
  return 'SEEN';
}

export function annotate(prs, viewed, observed, lastDismissedAt) {
  return prs.map((pr) => ({
    ...pr,
    status: classify(pr, viewed, observed, lastDismissedAt),
  }));
}
