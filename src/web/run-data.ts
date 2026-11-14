import type { Repository, IssueSummary, IssueDetail } from "./api-types.ts";

export interface RunDataSource {
  snapshot(): Promise<RunDataSnapshot>;
  subscribe(listener: (change: RunDataChange) => void): () => void;
}

export interface RunDataSnapshot {
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issues: readonly IssueSummary[];
  readonly details: Readonly<Record<string, IssueDetail>>;
}

export interface RunDataChange {
  readonly revision: string;
}
