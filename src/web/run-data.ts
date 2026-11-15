import type {
  Repository,
  IssueSummary,
  IssueDetail,
  IssueUpdate,
} from "./api-types.ts";

export interface RunDataSource {
  snapshot(selection?: { issue: number }): Promise<RunDataSnapshot>;
  subscribe(
    selection: { issue: number; lastEventId: string | null },
    listener: (update: IssueUpdate) => void,
  ): () => void;
}

export interface RunDataSnapshot {
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issues: readonly IssueSummary[];
  readonly details: Readonly<Record<string, IssueDetail>>;
}
