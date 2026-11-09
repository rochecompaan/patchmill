import type { Host, Issue } from "../host/types.ts";
import { STATE_DIR, type StateStore, type SyncCursor } from "./store.ts";

export const SYNC_OVERLAP_MS = 5 * 60_000;

export async function checkStateRepository(
  host: Pick<Host, "repository">,
  store: StateStore,
): Promise<{ cursor: SyncCursor | undefined; repository: string | undefined }> {
  const cursor = await store.readCursor();
  if (!cursor) return { cursor, repository: undefined };
  const { owner, repo } = await host.repository();
  const repository = `${owner}/${repo}`;
  if (cursor.repository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error(
      `Local state in ${STATE_DIR} belongs to ${cursor.repository}, not ${repository}. Move ${STATE_DIR} aside to start again.`,
    );
  }

  return { cursor, repository };
}

export async function syncIssues(input: {
  host: Host;
  store: StateStore;
  now: () => Date;
  issue?: number;
  warn: (message: string) => void;
}): Promise<SyncCursor> {
  return input.store.withCacheLock(() => syncIssuesUnlocked(input));
}

async function syncIssuesUnlocked(
  input: Parameters<typeof syncIssues>[0],
): Promise<SyncCursor> {
  const { host, store, now, issue, warn } = input;
  const checked = await checkStateRepository(host, store);
  const { cursor } = checked;
  let repository = checked.repository;
  if (repository === undefined) {
    const { owner, repo } = await host.repository();
    repository = `${owner}/${repo}`;
  }
  const started = now().toISOString();
  const { issues, damaged } = await store.listIssues();
  const full = !cursor || damaged.length > 0;
  const since = full
    ? undefined
    : new Date(Date.parse(cursor.syncedUpTo) - SYNC_OVERLAP_MS).toISOString();
  const listed = await host.listIssuesSince(since);
  const comments = await host.listCommentsSince(since);
  const copies = new Map(issues.map((copy) => [copy.number, copy]));
  const changed = new Set<number>();
  for (const listedIssue of listed) {
    copies.set(listedIssue.number, {
      ...listedIssue,
      comments: full ? [] : (copies.get(listedIssue.number)?.comments ?? []),
    });
    changed.add(listedIssue.number);
  }
  for (const { issue: n, ...comment } of comments) {
    const copy = copies.get(n);
    if (!copy) continue;
    const index = copy.comments.findIndex(
      (stored) => stored.url === comment.url,
    );
    if (index === -1) copy.comments.push(comment);
    else copy.comments[index] = comment;
    changed.add(n);
  }
  for (const n of changed) {
    await store.writeIssue(copies.get(n)!);
  }
  if (issue !== undefined) await refreshIssueUnlocked(host, store, issue);
  if (full) {
    const returned = new Set(listed.map((copy) => copy.number));
    for (const n of damaged) {
      if (returned.has(n)) continue;
      await store.removeIssue(n);
      warn(`Removed damaged issue copy ${store.issuePath(n)}`);
    }
  }
  const next = {
    repository,
    fullSyncAt: full ? started : cursor.fullSyncAt,
    syncedUpTo: started,
  };
  await store.writeCursor(next);
  return next;
}

export async function refreshIssue(
  host: Host,
  store: StateStore,
  n: number,
): Promise<Issue> {
  return store.withCacheLock(() => refreshIssueUnlocked(host, store, n));
}

async function refreshIssueUnlocked(
  host: Host,
  store: StateStore,
  n: number,
): Promise<Issue> {
  const issue = await host.viewIssue(n);
  await store.writeIssue(issue);
  return issue;
}
