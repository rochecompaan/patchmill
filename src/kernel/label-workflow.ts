import type { LabelsConfig } from "../config/config.ts";
import type { Host, Issue } from "../host/types.ts";
import type { WorkflowStatus } from "../state/store.ts";
import { KERNEL_COMMENT, kernelComment } from "./comments.ts";
import { ensureLabels } from "./labels.ts";
import type {
  StatusUpdate,
  TrackedIssue,
  WorkflowState,
} from "./workflow-state.ts";

const precedence: WorkflowStatus[] = [
  "inProgress",
  "ready",
  "done",
  "unsuitable",
  "needsInfo",
];

export class LabelWorkflowState implements WorkflowState {
  private labelsReady?: Promise<unknown>;
  private host: Host;
  private labels: LabelsConfig;

  constructor(host: Host, labels: LabelsConfig) {
    this.host = host;
    this.labels = labels;
  }

  async sync(): Promise<void> {}

  private tracked(issue: Issue): TrackedIssue {
    return {
      ...issue,
      status:
        precedence.find((status) =>
          issue.labels.includes(this.labels[status]),
        ) ?? "untriaged",
      comments: issue.comments.map((comment) => ({
        ...comment,
        fromPatchmill: comment.body.startsWith(KERNEL_COMMENT),
      })),
    };
  }

  async openIssues(): Promise<TrackedIssue[]> {
    return (await this.host.listOpenIssues()).map((issue) =>
      this.tracked(issue),
    );
  }

  async issue(n: number): Promise<TrackedIssue> {
    return this.tracked(await this.host.viewIssue(n));
  }

  async setStatus(n: number, update: StatusUpdate): Promise<string[]> {
    await (this.labelsReady ??= ensureLabels(this.host, this.labels));
    const label = this.labels[update.status];
    const comment = async () =>
      this.host.commentIssue(
        n,
        kernelComment({
          issue: n,
          label,
          summary: update.summary!,
          ...(update.cost !== undefined ? { cost: update.cost } : {}),
          ...(update.warnings ? { warnings: update.warnings } : {}),
        }),
      );
    let questionUrl: string | undefined;
    if (update.question !== undefined && update.summary) {
      try {
        questionUrl = await comment();
      } catch (error) {
        throw new Error(`Comment failed: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    }
    try {
      await this.host.setLabels(
        n,
        [label],
        Object.values(this.labels).filter((other) => other !== label),
      );
    } catch (error) {
      throw new Error(
        `Label update failed: ${errorMessage(error)}${questionUrl !== undefined ? ` (comment posted at ${questionUrl})` : ""}`,
        { cause: error },
      );
    }
    if (update.summary && update.question === undefined) {
      try {
        await comment();
      } catch (error) {
        return [`Comment failed: ${errorMessage(error)}`];
      }
    }
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
