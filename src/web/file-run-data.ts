import { createHash } from "node:crypto";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
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
import type { DocumentLink, IssueSummary, Repository } from "./api-types.ts";
import type {
  RunDataSource,
  RunDataSnapshot,
  RunDataChange,
} from "./run-data.ts";

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

export function createFileRunDataSource(input: {
  repoRoot: string;
  config: PatchmillConfig;
  host: Pick<Host, "listOpenIssues" | "listOpenPullRequests">;
  metadata: BoardRepository;
  runner: CommandRunner;
  now: () => Date;
  warn: (message: string) => void;
}): RunDataSource {
  const { config, metadata, repoRoot, warn } = input;
  const cache = createHostBoardCache(input);
  const store = new StateStore(stateDir(repoRoot), () =>
    warn("Could not read optional local workflow data."),
  );
  const listeners = new Set<(change: RunDataChange) => void>();
  let previousRevision: string | undefined;
  let pending: Promise<RunDataSnapshot> | undefined;
  async function snapshot(): Promise<RunDataSnapshot> {
    if (config.workflow.stateTracking === "local") {
      const cursor = await store.readCursor();
      if (
        cursor &&
        cursor.repository.toLowerCase() !==
          metadata.repository.name.toLowerCase()
      )
        throw Error("Local workflow data belongs to a different repository.");
    }
    const host = await cache.read();
    const issues: IssueSummary[] = [];
    const documents = createDocumentLinkReader({
      ...input,
      baseBranch: metadata.baseBranch,
      repositoryUrl: metadata.pushRepository.url,
      provider: config.host.provider,
    });
    const unique = new Map(
      host.issues
        .filter(
          (i) =>
            i.state === "open" &&
            Number.isSafeInteger(i.number) &&
            i.number > 0,
        )
        .map((i) => [i.number, i]),
    );
    for (const issue of [...unique.values()].sort(
      (a, b) => a.number - b.number,
    )) {
      let roles: readonly WorkflowStatus[] = [];
      try {
        roles = await readWorkflowRoles(issue, { config, store });
      } catch {
        warn(`Could not read workflow role for issue #${issue.number}.`);
      }
      if (roles.includes("unsuitable")) continue;
      const run = await readIssueObservation({ ...input, issue: issue.number });
      const associated = associatePullRequests({
        issue: issue.number,
        candidates: host.pullRequests,
        observed: run.pullRequest,
        pushRepository: metadata.pushRepository.slug,
        baseBranch: metadata.baseBranch,
      });
      let documentLinks: readonly DocumentLink[] = [];
      try {
        documentLinks = await documents(issue.number, [
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
      if (summary) issues.push(summary);
    }
    const repository = { ...metadata.repository };
    const revision = createHash("sha256")
      .update(JSON.stringify({ repository, issues }))
      .digest("hex");
    const result: RunDataSnapshot = {
      repository,
      source: "live",
      revision,
      syncedAt: host.syncedAt,
      issues,
      details: Object.fromEntries(
        issues.map((summary) => [
          String(summary.number),
          {
            summary,
            participants: [],
            thread: [],
            artifacts: [],
            finalUsage: null,
          },
        ]),
      ),
    };
    freeze(result);
    const changed =
      previousRevision !== undefined && previousRevision !== revision;
    previousRevision = revision;
    if (changed)
      for (const listener of listeners) {
        try {
          listener({ revision });
        } catch {
          warn("Board change listener failed.");
        }
      }
    return result;
  }
  return {
    snapshot() {
      pending ??= snapshot().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
