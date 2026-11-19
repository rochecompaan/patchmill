import { createHash, randomBytes } from "node:crypto";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
import type { CommandRunner } from "../process/command.ts";
import { stateDir, StateStore } from "../state/store.ts";
import type { WorkflowStatus } from "../kernel/workflow-state.ts";
import { createHostBoardCache } from "./host-board-cache.ts";
import {
  readIssueObservation,
  readWorkflowRoles,
} from "./file-run-observations.ts";
import {
  associatePullRequests,
  projectBoardIssue,
} from "./board-projection.ts";
import { createDocumentLinkReader } from "./document-links.ts";
import type {
  DocumentLink,
  IssueDetail,
  IssueSummary,
  LiveSession,
  Repository,
} from "./api-types.ts";
import type { SessionHub } from "./session/types.ts";
import { readIssueDetail } from "./file-issue-detail.ts";
import type { RunDataSource, RunDataSnapshot } from "./run-data.ts";
import { createIssueFeed, type FeedClock } from "./issue-feed.ts";
import { issueFingerprint } from "./run-fingerprint.ts";

export type BoardRepository = {
  repository: Repository;
  baseBranch: string;
  pushRepository: { slug: string; url: string };
};
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clock: FeedClock = {
  now: () => Date.now(),
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    timer.unref();
    return () => clearInterval(timer);
  },
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

/**
 * Add the Web session to an issue detail. While a session is shown, the
 * run-file copies of its span (console transcript, progress lines and the
 * "pending" notice) are hidden, so nothing appears twice.
 */
export function withLiveSession(
  detail: IssueDetail,
  session: LiveSession | null,
): IssueDetail {
  if (!session) return { ...detail, session: null };
  const since = Date.parse(session.startedAt);
  const thread = detail.thread.filter((entry) => {
    if (entry.id.endsWith(":interactive-pending")) return false;
    const duplicate =
      entry.id.includes(":console-planning.jsonl:") ||
      entry.id.includes(":history:");
    return !(duplicate && entry.at !== null && Date.parse(entry.at) >= since);
  });
  return { ...detail, thread, session };
}

export function createFileRunDataSource(input: {
  repoRoot: string;
  config: PatchmillConfig;
  host: Pick<Host, "listOpenIssues" | "listOpenPullRequests">;
  metadata: BoardRepository;
  runner: CommandRunner;
  now: () => Date;
  warn: (message: string) => void;
  clock?: FeedClock;
  epoch?: () => string;
  sessions?: Pick<SessionHub, "current" | "subscribe">;
}): RunDataSource {
  const { config, metadata, repoRoot, warn, sessions } = input;
  const live = (number: number) => sessions?.current(number) ?? null;
  const cache = createHostBoardCache(input);
  const store = new StateStore(stateDir(repoRoot), () =>
    warn("Could not read optional local workflow data."),
  );
  const pending = new Map<number | null, Promise<RunDataSnapshot>>();
  async function checkRepository() {
    if (config.workflow.stateTracking !== "local") return;
    const cursor = await store.readCursor();
    if (
      cursor &&
      cursor.repository.toLowerCase() !== metadata.repository.name.toLowerCase()
    )
      throw Error("Local workflow data belongs to a different repository.");
  }
  function documents() {
    return createDocumentLinkReader({
      ...input,
      baseBranch: metadata.baseBranch,
      repositoryUrl: metadata.pushRepository.url,
      provider: config.host.provider,
    });
  }
  async function projectIssue(
    issue: Issue,
    pulls: readonly PullRequest[],
    links: ReturnType<typeof documents>,
    withDetail: boolean,
  ) {
    let roles: readonly WorkflowStatus[] = [];
    try {
      roles = await readWorkflowRoles(issue, { config, store });
    } catch {
      warn(`Could not read workflow role for issue #${issue.number}.`);
    }
    if (roles.includes("unsuitable")) return null;
    const run = await readIssueObservation({ ...input, issue: issue.number });
    const associated = associatePullRequests({
      issue: issue.number,
      candidates: pulls,
      observed: run.pullRequest,
      historical: run.historicalPullRequests ?? [],
      pushRepository: metadata.pushRepository.slug,
      baseBranch: metadata.baseBranch,
    });
    let documentLinks: readonly DocumentLink[] = [];
    try {
      documentLinks = await links(issue.number, [
        ...(run.branch ? [run.branch] : []),
        ...associated.branches,
      ]);
    } catch {
      warn(`Could not read document links for issue #${issue.number}.`);
    }
    const summary = projectBoardIssue({
      issue,
      roles,
      run,
      pullRequests: associated.pullRequests,
      documentLinks,
      labels: config.labels,
    });
    if (!summary) return null;
    return {
      summary,
      detail: withDetail
        ? await readIssueDetail({ ...input, issue, summary, observation: run })
        : null,
    };
  }
  const eligible = (issue: Issue) =>
    issue.state === "open" &&
    Number.isSafeInteger(issue.number) &&
    issue.number > 0;
  async function snapshot(selection?: {
    issue: number;
  }): Promise<RunDataSnapshot> {
    await checkRepository();
    const host = await cache.read(),
      links = documents();
    const issues: IssueSummary[] = [],
      details: Record<string, IssueDetail> = {};
    const unique = new Map(
      host.issues.filter(eligible).map((i) => [i.number, i]),
    );
    for (const issue of [...unique.values()].sort(
      (a, b) => a.number - b.number,
    )) {
      const projected = await projectIssue(
        issue,
        host.pullRequests,
        links,
        selection?.issue === issue.number,
      );
      if (projected) {
        issues.push(projected.summary);
        if (projected.detail)
          details[String(issue.number)] = withLiveSession(
            projected.detail,
            live(issue.number),
          );
      }
    }
    const repository = { ...metadata.repository };
    const boardRevision = hash({ repository, issues });
    const result: RunDataSnapshot = {
      repository,
      source: "live",
      revision: selection ? hash({ boardRevision, details }) : boardRevision,
      syncedAt: host.syncedAt,
      sessions: !!sessions,
      issues,
      details,
    };
    freeze(result);
    return result;
  }
  const feed = createIssueFeed({
    clock: input.clock ?? clock,
    epoch: input.epoch ?? (() => randomBytes(4).toString("hex")),
    warn,
    ...(sessions ? { sessions } : {}),
    fingerprint: (issue) => issueFingerprint({ ...input, issue }),
    async project(number) {
      await checkRepository();
      const host = await cache.read();
      const issue = host.issues.find((i) => i.number === number && eligible(i));
      if (!issue) return null;
      const projected = await projectIssue(
        issue,
        host.pullRequests,
        documents(),
        true,
      );
      if (!projected?.detail) return null;
      // After the last await: the feed folds later session changes itself.
      const detail = withLiveSession(projected.detail, live(number));
      const response = {
        schemaVersion: 1 as const,
        repository: { ...metadata.repository },
        source: "live" as const,
        revision: hash(projected.detail),
        syncedAt: host.syncedAt,
        sessions: !!sessions,
        issue: detail,
      };
      freeze(response);
      return response;
    },
  });
  return {
    snapshot(selection) {
      const key = selection?.issue ?? null;
      let work = pending.get(key);
      if (!work) {
        work = snapshot(selection).finally(() => {
          pending.delete(key);
        });
        pending.set(key, work);
      }
      return work;
    },
    subscribe: feed.subscribe,
  };
}
