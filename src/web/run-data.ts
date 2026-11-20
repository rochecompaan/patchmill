import type {
  Repository,
  IssueSummary,
  IssueDetail,
  IssueUpdate,
} from "./api-types.ts";
import type { IssueFile } from "./issue-documents.ts";

export interface RunDataSource {
  snapshot(selection?: { issue: number }): Promise<RunDataSnapshot>;
  subscribe(
    selection: { issue: number; lastEventId: string | null },
    listener: (update: IssueUpdate) => void,
  ): () => void;
  /**
   * One HTML Issue document by the ID that the issue detail lists. Absent in
   * sample mode, where the file route answers 404.
   */
  documentFile?(issue: number, id: string): Promise<IssueFile | null>;
}

export interface RunDataSnapshot {
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  /** The server has a Session hub. */
  readonly sessions: boolean;
  readonly issues: readonly IssueSummary[];
  readonly details: Readonly<Record<string, IssueDetail>>;
}
