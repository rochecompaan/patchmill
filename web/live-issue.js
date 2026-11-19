/** @typedef {import('../src/web/api-types.ts').IssueResponse} IssueResponse */
/** @param {IssueResponse} response @param {import('../src/web/api-types.ts').IssueUpdate} update @returns {IssueResponse} */
export function applyIssueUpdate(response, update) {
  if (update.kind === "reset") return update.issue;
  if (update.kind === "header")
    return {
      ...response,
      syncedAt: update.syncedAt,
      issue: {
        ...update.header,
        thread: response.issue.thread,
        session: response.issue.session ?? null,
      },
    };
  if (update.kind === "thread") {
    const index =
      update.after === null
        ? -1
        : response.issue.thread.findIndex((e) => e.id === update.after);
    return {
      ...response,
      issue: {
        ...response.issue,
        thread: [
          ...response.issue.thread.slice(0, index + 1),
          ...update.entries,
        ],
      },
    };
  }
  return response;
}
/** @param {import('../src/web/api-types.ts').IssueDetail} detail @param {number} nowMs */
export function liveElapsedSeconds(detail, nowMs) {
  if (detail.run?.outcome !== "active" || !detail.run.activeSince)
    return detail.summary.elapsedSeconds;
  const start = Date.parse(detail.run.activeSince);
  if (!Number.isFinite(start)) return detail.summary.elapsedSeconds;
  return (
    (detail.summary.elapsedSeconds ?? 0) +
    Math.max(0, Math.floor((nowMs - start) / 1000))
  );
}
