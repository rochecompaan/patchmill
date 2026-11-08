import type { Host, Issue } from "../host/types.ts";
import type { StateStore, StatusChange } from "../state/store.ts";
import {
  checkStateRepository,
  refreshIssue,
  syncIssues,
} from "../state/sync.ts";
import type {
  StatusUpdate,
  TrackedIssue,
  WorkflowState,
} from "./workflow-state.ts";

export class LocalWorkflowState implements WorkflowState {
  private repositoryChecked = false;
  private host: Host;
  private store: StateStore;
  private now: () => Date;
  private warn: (message: string) => void;

  constructor(input: {
    host: Host;
    store: StateStore;
    now: () => Date;
    warn: (message: string) => void;
  }) {
    this.host = input.host;
    this.store = input.store;
    this.now = input.now;
    this.warn = input.warn;
  }

  async sync(issue?: number): Promise<void> {
    await syncIssues({
      host: this.host,
      store: this.store,
      now: this.now,
      ...(issue !== undefined ? { issue } : {}),
      warn: this.warn,
    });
    this.repositoryChecked = true;
  }

  private async checkRepository(): Promise<void> {
    if (!this.repositoryChecked) {
      await checkStateRepository(this.host, this.store);
      this.repositoryChecked = true;
    }
  }

  private async tracked(issue: Issue): Promise<TrackedIssue> {
    const changes = await this.store.readStatus(issue.number);
    const last = changes.at(-1);
    const questionUrls = new Set(
      changes.flatMap((change) =>
        change.questionUrl !== undefined ? [change.questionUrl] : [],
      ),
    );
    return {
      ...issue,
      status: last?.status ?? "untriaged",
      ...(last !== undefined ? { statusSince: last.at } : {}),
      comments: issue.comments.map((comment) => ({
        ...comment,
        fromPatchmill:
          comment.url !== undefined && questionUrls.has(comment.url),
      })),
    };
  }

  async openIssues(): Promise<TrackedIssue[]> {
    const { issues, damaged } = await this.store.listIssues();
    if (damaged.length > 0) {
      throw new Error(`Damaged issue copies: ${damaged.join(", ")}`);
    }
    return Promise.all(
      issues
        .filter((issue) => issue.state === "open")
        .map((issue) => this.tracked(issue)),
    );
  }

  async issue(n: number): Promise<TrackedIssue> {
    await this.checkRepository();
    return this.tracked(await refreshIssue(this.host, this.store, n));
  }

  async setStatus(n: number, update: StatusUpdate): Promise<string[]> {
    await this.checkRepository();
    let questionUrl: string | undefined;
    if (update.question?.trim()) {
      try {
        questionUrl = await this.host.commentIssue(n, update.question);
      } catch (error) {
        throw new Error(`Comment failed: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    }
    try {
      const change: StatusChange = {
        at: this.now().toISOString(),
        status: update.status,
        ...(update.runId !== undefined ? { runId: update.runId } : {}),
        ...(update.summary !== undefined ? { summary: update.summary } : {}),
        ...(update.cost !== undefined ? { cost: update.cost } : {}),
        ...(update.warnings !== undefined ? { warnings: update.warnings } : {}),
        ...(questionUrl !== undefined ? { questionUrl } : {}),
      };
      await this.store.appendStatus(n, change);
    } catch (error) {
      throw new Error(
        `Status update failed: ${errorMessage(error)}${questionUrl !== undefined ? ` (question posted at ${questionUrl})` : ""}`,
        { cause: error },
      );
    }
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
