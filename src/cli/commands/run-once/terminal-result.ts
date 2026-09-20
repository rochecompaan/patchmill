import { formatPlanningCleanupPath } from "./planning-cleanup-pending.ts";
import type {
  RunOnceResultStatus,
  RunOnceResultSummary,
} from "./result-summary.ts";
import {
  cleanValue,
  renderTerminalDocument,
} from "./terminal-result-layout.ts";
import type {
  TerminalSection,
  TerminalValue,
} from "./terminal-result-layout.ts";

export type TerminalResultSeverity = "success" | "warning" | "failure";
export type TerminalResultOptions = {
  width: number;
  color: boolean;
  stepNumber?: number | undefined;
  totalOutputTokens?: number | undefined;
  elapsedSeconds?: number | undefined;
};
const STATUS = {
  "no-issue": { label: "No eligible issue", severity: "success" },
  "dry-run": { label: "Dry run", severity: "success" },
  "spec-created": { label: "Specification created", severity: "success" },
  "spec-found": { label: "Specification found", severity: "success" },
  "plan-created": { label: "Implementation plan created", severity: "success" },
  "plan-found": { label: "Implementation plan found", severity: "success" },
  "pr-created": { label: "PR created", severity: "success" },
  merged: { label: "Merged", severity: "success" },
  "review-pending": { label: "Review pending", severity: "warning" },
  "cleanup-pending": { label: "Cleanup pending", severity: "warning" },
  stopped: { label: "Stopped", severity: "warning" },
  "approval-required": { label: "Approval required", severity: "warning" },
  "development-environment-not-ready": {
    label: "Development environment not ready",
    severity: "warning",
  },
  blocked: { label: "Blocked", severity: "failure" },
  error: { label: "Error", severity: "failure" },
} as const satisfies Record<
  RunOnceResultStatus,
  { label: string; severity: TerminalResultSeverity }
>;

const nonblank = (text: string | undefined): text is string =>
  typeof text === "string" && Boolean(cleanValue(text));
const value = (
  text: string,
  role: TerminalValue["role"] = "plain",
): TerminalValue => ({ text, role });

function detailRole(key: string): TerminalValue["role"] {
  return key.toLowerCase().includes("path")
    ? "path"
    : key.toLowerCase().includes("url")
      ? "url"
      : key.toLowerCase().includes("commit") ||
          key.toLowerCase().includes("oid")
        ? "commit"
        : "plain";
}

function diagnosticSections(summary: RunOnceResultSummary): TerminalSection[] {
  if (
    !("diagnostic" in summary) ||
    !summary.diagnostic ||
    !("reason" in summary) ||
    !summary.reason
  )
    return [];
  const diagnostic = summary.diagnostic;
  return [
    {
      heading: "Failure",
      blocks: [
        {
          kind: "fields",
          fields: [
            { label: "Reason", value: value(summary.reason) },
            { label: "Explanation", value: value(diagnostic.explanation) },
          ],
        },
      ],
    },
    ...(diagnostic.details.length
      ? [
          {
            heading: "Details",
            blocks: [
              {
                kind: "fields" as const,
                fields: diagnostic.details.flatMap((entry) => {
                  const role = detailRole(entry.key);
                  if (Array.isArray(entry.value) && role === "path")
                    return entry.value.map((path) => ({
                      label: entry.label,
                      value: value(formatPlanningCleanupPath(path), role),
                    }));
                  return [
                    {
                      label: entry.label,
                      value: value(
                        Array.isArray(entry.value)
                          ? entry.value.join("\n")
                          : String(entry.value),
                        role,
                      ),
                    },
                  ];
                }),
              },
            ],
          },
        ]
      : []),
    {
      heading: "Recommended action",
      blocks: [
        {
          kind: "list",
          marker: "→",
          markerSeverity: "warning",
          items: diagnostic.actions.map((action) => ({
            value: value(action.description),
            ...(action.command
              ? {
                  details: [
                    {
                      label: "Command",
                      value: value(action.command, "commit"),
                    },
                  ],
                }
              : {}),
          })),
        },
      ],
    },
    {
      heading: "Safety",
      blocks: [
        {
          kind: "list",
          marker: "!",
          markerSeverity: "warning",
          items: diagnostic.safety.map((warning) => ({
            value: value(warning),
          })),
        },
      ],
    },
    {
      heading: "Retry",
      blocks: [
        {
          kind: "fields",
          fields: [
            { label: "Kind", value: value(diagnostic.retry.kind) },
            { label: "Guidance", value: value(diagnostic.retry.guidance) },
          ],
        },
      ],
    },
  ];
}
export function terminalResultSeverity(
  status: RunOnceResultStatus,
): TerminalResultSeverity {
  return STATUS[status].severity;
}

export function formatTerminalResult(
  summary: RunOnceResultSummary,
  options: TerminalResultOptions,
): string {
  const sections: TerminalSection[] = [];
  sections.push(...diagnosticSections(summary));
  if (summary.status === "stopped" && !summary.diagnostic)
    sections.push({
      heading: "Stopped",
      blocks: [
        {
          kind: "fields",
          fields: [
            { label: "Reason", value: value(summary.reason) },
            ...(summary.nextPhase !== undefined
              ? [{ label: "Next phase", value: value(summary.nextPhase) }]
              : []),
          ],
        },
      ],
    });
  if ("prUrl" in summary && nonblank(summary.prUrl))
    sections.push({
      heading: "Pull request",
      blocks: [{ kind: "value", value: value(summary.prUrl, "url") }],
    });
  if ("issueNumber" in summary) {
    const fields = [
      { label: "Issue", value: value(`#${summary.issueNumber}`) },
      ...("title" in summary && nonblank(summary.title)
        ? [{ label: "Title", value: value(summary.title) }]
        : []),
      ...("branch" in summary && nonblank(summary.branch)
        ? [{ label: "Branch", value: value(summary.branch, "path") }]
        : []),
      ...("worktreePath" in summary && nonblank(summary.worktreePath)
        ? [{ label: "Worktree", value: value(summary.worktreePath, "path") }]
        : []),
    ];
    sections.push({
      heading: "Issue and workspace",
      blocks: [{ kind: "fields", fields }],
    });
  }
  const artifacts = [
    "specPath" in summary && nonblank(summary.specPath)
      ? {
          value: value("Specification"),
          details: [
            { label: undefined, value: value(summary.specPath, "path") },
          ],
        }
      : undefined,
    "planPath" in summary && nonblank(summary.planPath)
      ? {
          value: value("Implementation plan"),
          details: [
            { label: undefined, value: value(summary.planPath, "path") },
          ],
        }
      : undefined,
  ].filter((item): item is NonNullable<typeof item> => item !== undefined);
  if (artifacts.length)
    sections.push({
      heading: "Artifacts",
      blocks: [{ kind: "list", marker: "•", items: artifacts }],
    });
  if (summary.status === "dry-run")
    sections.push({
      heading: "Transition",
      blocks: [
        {
          kind: "fields",
          fields: [{ label: "Transition", value: value(summary.transition) }],
        },
      ],
    });
  if (summary.status === "cleanup-pending" && !summary.diagnostic)
    sections.push({
      heading: "Cleanup pending",
      blocks: [
        {
          kind: "fields",
          fields: [
            { label: "Phase", value: value(summary.phase) },
            { label: "Reason", value: value(summary.reason) },
          ],
        },
        {
          kind: "list",
          marker: "!",
          markerSeverity: "warning",
          items: summary.ignoredPaths.map((path) => ({
            value: value(formatPlanningCleanupPath(path), "path"),
          })),
        },
        {
          kind: "list",
          marker: "→",
          markerSeverity: "warning",
          items: summary.remediation.map((text) => ({ value: value(text) })),
        },
      ],
    });
  if (summary.status === "review-pending")
    sections.push({
      heading: "Review pending",
      blocks: [
        {
          kind: "fields",
          fields: [{ label: "Phase", value: value(summary.phase) }],
        },
      ],
    });
  if (summary.status === "approval-required")
    sections.push({
      heading: "Approval",
      blocks: [
        {
          kind: "fields",
          fields: [
            { label: "Kind", value: value(summary.approvalKind) },
            { label: "Missing label", value: value(summary.missingLabel) },
          ],
        },
      ],
    });
  if (
    summary.status === "development-environment-not-ready" &&
    !summary.diagnostic
  )
    sections.push({
      heading: "Environment readiness",
      blocks: [
        {
          kind: "fields",
          fields: [{ label: "Reason", value: value(summary.reason) }],
        },
        ...(summary.evidence.filter(nonblank).length
          ? [
              {
                kind: "list" as const,
                marker: "!" as const,
                markerSeverity: "warning" as const,
                items: summary.evidence
                  .filter(nonblank)
                  .map((text) => ({ value: value(text) })),
              },
            ]
          : []),
        ...(summary.remediation.filter(nonblank).length
          ? [
              {
                kind: "list" as const,
                marker: "→" as const,
                markerSeverity: "warning" as const,
                items: summary.remediation
                  .filter(nonblank)
                  .map((text) => ({ value: value(text) })),
              },
            ]
          : []),
      ],
    });
  if (
    (summary.status === "blocked" || summary.status === "error") &&
    !summary.diagnostic
  ) {
    const reason =
      summary.status === "blocked" ? summary.reason : summary.error;
    const causes = summary.status === "error" ? (summary.causes ?? []) : [];
    sections.push({
      heading: "Failure",
      blocks: [
        { kind: "fields", fields: [{ label: "Reason", value: value(reason) }] },
        ...(causes.filter(nonblank).length
          ? [
              {
                kind: "list" as const,
                marker: "✗" as const,
                markerSeverity: "failure" as const,
                items: causes
                  .filter(nonblank)
                  .map((text) => ({ value: value(text) })),
              },
            ]
          : []),
      ],
    });
  }
  if (summary.status === "blocked" && summary.questions.filter(nonblank).length)
    sections.push({
      heading: "Questions",
      count: summary.questions.filter(nonblank).length,
      blocks: [
        {
          kind: "list",
          marker: "✗",
          markerSeverity: "failure",
          items: summary.questions
            .filter(nonblank)
            .map((text) => ({ value: value(text) })),
        },
      ],
    });
  if ("validation" in summary && summary.validation.filter(nonblank).length)
    sections.push({
      heading: "Validation",
      count: summary.validation.filter(nonblank).length,
      blocks: [
        {
          kind: "list",
          marker: "✓",
          markerSeverity: "success",
          items: summary.validation
            .filter(nonblank)
            .map((text) => ({ value: value(text) })),
        },
      ],
    });
  if ("reviewSummary" in summary && nonblank(summary.reviewSummary))
    sections.push({
      heading: "Review",
      blocks: [{ kind: "value", value: value(summary.reviewSummary) }],
    });
  if (
    ("landingDecision" in summary && nonblank(summary.landingDecision)) ||
    summary.status === "merged"
  )
    sections.push({
      heading: "Landing decision",
      blocks: [
        {
          kind: "fields",
          fields: [
            ...("landingDecision" in summary &&
            nonblank(summary.landingDecision)
              ? [{ label: undefined, value: value(summary.landingDecision) }]
              : []),
            ...(summary.status === "merged"
              ? [
                  {
                    label: "Merge commit",
                    value: value(summary.mergeCommit, "commit"),
                  },
                ]
              : []),
          ],
        },
      ],
    });
  if ("commits" in summary && summary.commits.filter(nonblank).length)
    sections.push({
      heading: "Commits",
      count: summary.commits.filter(nonblank).length,
      blocks: [
        {
          kind: "list",
          marker: "•",
          items: summary.commits
            .filter(nonblank)
            .map((text) => ({ value: value(text, "commit") })),
        },
      ],
    });
  const visualEvidence =
    ("visualEvidence" in summary ? summary.visualEvidence : undefined)?.flatMap(
      (item) => {
        const caption = nonblank(item.caption) ? item.caption : undefined;
        const screenshotPath = nonblank(item.screenshotPath)
          ? item.screenshotPath
          : undefined;
        if (!caption && !screenshotPath) return [];
        return [
          {
            value: caption ? value(caption) : value(screenshotPath!, "path"),
            details: [
              ...(caption && screenshotPath
                ? [
                    {
                      label: "Screenshot",
                      value: value(screenshotPath, "path"),
                    },
                  ]
                : []),
              ...(item.referencePaths ?? []).filter(nonblank).map((text) => ({
                label: "Reference",
                value: value(text, "path"),
              })),
              ...(item.url && nonblank(item.url)
                ? [{ label: "URL", value: value(item.url, "url") }]
                : []),
            ],
          },
        ];
      },
    ) ?? [];
  if (visualEvidence.length)
    sections.push({
      heading: "Visual evidence",
      count: visualEvidence.length,
      blocks: [{ kind: "list", marker: "•", items: visualEvidence }],
    });
  const files = [
    "logPath" in summary && nonblank(summary.logPath)
      ? {
          value: value("Log"),
          details: [{ value: value(summary.logPath, "path") }],
        }
      : undefined,
    "piSessionPath" in summary && nonblank(summary.piSessionPath)
      ? {
          value: value("Pi sessions"),
          details: [{ value: value(summary.piSessionPath, "path") }],
        }
      : undefined,
  ].filter((item): item is NonNullable<typeof item> => item !== undefined);
  if (files.length)
    sections.push({
      heading: "Run files",
      blocks: [{ kind: "list", marker: "•", items: files }],
    });
  return renderTerminalDocument({
    width: options.width,
    color: options.color,
    label: STATUS[summary.status].label,
    severity: STATUS[summary.status].severity,
    sections,
    ...(options.stepNumber === undefined
      ? {}
      : { stepNumber: options.stepNumber }),
    ...(options.totalOutputTokens === undefined
      ? {}
      : { totalOutputTokens: options.totalOutputTokens }),
    ...(options.elapsedSeconds === undefined
      ? {}
      : { elapsedSeconds: options.elapsedSeconds }),
  });
}
