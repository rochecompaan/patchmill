import { formatPlanningCleanupPath } from "./planning-cleanup-pending.ts";
import type { RunOnceResultSummary } from "./result-summary.ts";
import type {
  TerminalSection,
  TerminalValue,
} from "./terminal-result-layout.ts";

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

function isRepeatedIssueWorkspaceDetail(
  summary: RunOnceResultSummary,
  key: string,
): boolean {
  switch (key) {
    case "issueNumber":
      return "issueNumber" in summary;
    case "branch":
      return "branch" in summary && Boolean(summary.branch?.trim());
    case "worktreePath":
      return "worktreePath" in summary && Boolean(summary.worktreePath?.trim());
    default:
      return false;
  }
}

/** Renders the catalog materialized at the result-summary boundary. */
export function diagnosticSections(
  summary: RunOnceResultSummary,
): TerminalSection[] {
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
                  if (
                    isRepeatedIssueWorkspaceDetail(summary, entry.key) ||
                    (summary.status === "blocked" &&
                      entry.key === "questions") ||
                    (summary.status === "error" && entry.key === "logPath")
                  )
                    return [];
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
