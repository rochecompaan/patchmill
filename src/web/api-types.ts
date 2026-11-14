export type ColumnId =
  | "triage"
  | "ready"
  | "planning"
  | "review"
  | "implementing"
  | "code"
  | "blocked";

export type IssueStatus =
  | "none"
  | "working"
  | "waiting"
  | "idle"
  | "paused"
  | "blocked"
  | "done";

export type PhaseId =
  | "brainstorm"
  | "spec"
  | "spec-review"
  | "plan"
  | "plan-review"
  | "implement"
  | "code-review";

export interface Repository {
  readonly name: string;
  readonly url: string;
}

export interface Label {
  readonly name: string;
  readonly tone: "neutral" | "ready" | "info" | "blocked";
}

export interface PullRequest {
  readonly number: number;
  readonly label: string;
  readonly url: string;
  readonly state: "open" | "merged" | "closed";
  readonly kind: "spec" | "plan" | "implementation";
}

export interface ArtifactLink {
  readonly id: string;
  readonly kind: "spec" | "plan" | "mockup" | "diagram" | "shots";
  readonly title: string;
}

export interface IssueSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly labels: readonly Label[];
  readonly column: ColumnId;
  readonly status: IssueStatus;
  readonly terminal: boolean;
  readonly phase: PhaseId | null;
  readonly step: string | null;
  readonly elapsedSeconds: number | null;
  readonly blockedReason: string | null;
  readonly pullRequests: readonly PullRequest[];
  readonly artifacts: readonly ArtifactLink[];
}

export interface BoardResponse {
  readonly schemaVersion: 1;
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issues: readonly IssueSummary[];
}

export interface IssueResponse {
  readonly schemaVersion: 1;
  readonly repository: Repository;
  readonly source: "sample" | "live";
  readonly revision: string;
  readonly syncedAt: string | null;
  readonly issue: IssueDetail;
}

export interface IssueDetail {
  readonly summary: IssueSummary;
  readonly participants: readonly string[];
  readonly thread: readonly ThreadEvent[];
  readonly artifacts: readonly Artifact[];
  readonly finalUsage: {
    readonly tokens: number | null;
    readonly cost: {
      readonly amount: string;
      readonly currency: string;
    } | null;
  } | null;
}

export type Inline =
  | { readonly kind: "text" | "code"; readonly text: string }
  | { readonly kind: "strong" | "emphasis"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type TextBlock =
  | {
      readonly kind: "paragraph" | "heading";
      readonly content: readonly Inline[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: "code"; readonly text: string }
  | {
      readonly kind: "table";
      readonly headers: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

export type ThreadEvent = {
  readonly id: string;
  readonly at: string | null;
} & (
  | { readonly kind: "step"; readonly number: number; readonly label: string }
  | {
      readonly kind: "message";
      readonly author: string;
      readonly role: "agent" | "person";
      readonly blocks: readonly TextBlock[];
      readonly note: string | null;
    }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly result: string | null;
      readonly state: "running" | "completed" | "stopped" | "failed";
    }
  | { readonly kind: "progress" | "earlier"; readonly text: string }
  | {
      readonly kind: "usage";
      readonly taskTokens: number;
      readonly totalTokens: number;
      readonly elapsedSeconds: number;
    }
  | {
      readonly kind: "divider";
      readonly tone: "advance" | "neutral" | "blocked";
      readonly text: string;
    }
  | { readonly kind: "error"; readonly title: string; readonly text: string }
  | {
      readonly kind: "artifact";
      readonly artifactId: string;
      readonly text: string;
    }
);

export type Artifact = ArtifactLink & {
  readonly path: string;
  readonly commit: string | null;
  readonly location: string;
  readonly draft: boolean;
  readonly sourceUrl: string | null;
} & (
    | {
        readonly kind: "spec" | "plan";
        readonly preview: {
          readonly kind: "document";
          readonly blocks: readonly TextBlock[];
        };
      }
    | {
        readonly kind: "mockup" | "diagram";
        readonly preview: { readonly kind: "page"; readonly url: string };
      }
    | {
        readonly kind: "shots";
        readonly preview: {
          readonly kind: "gallery";
          readonly shots: readonly {
            readonly url: string;
            readonly path: string;
            readonly caption: string;
          }[];
        };
      }
  );

export interface ApiError {
  readonly error: {
    readonly code: "invalid_issue" | "not_found" | "internal_error";
    readonly message: string;
  };
}
