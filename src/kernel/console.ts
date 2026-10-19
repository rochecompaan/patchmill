import type { Issue } from "../host/types.ts";
import type { Facts } from "./facts.ts";
import type { Derived, Phase } from "./phase.ts";
import type { PiUsage } from "./pi-cost.ts";
import {
  cleanValue,
  renderTerminalDocument,
  type TerminalSection,
  type TerminalResultSeverity,
} from "./terminal-layout.ts";

export type RunDisplay = {
  label: string;
  severity: TerminalResultSeverity;
  issue?: Issue;
  facts?: Facts;
  transition?: Derived | "ambiguous-branches";
  outcomeLabel?: string;
  summary?: string;
  warnings?: string[];
  logPath?: string;
  sessionPath?: string;
  cost?: string;
  elapsedSeconds?: number;
  usage?: PiUsage;
};

export function formatRunResult(
  display: RunDisplay,
  options = {
    width: process.stdout.columns ?? 80,
    color: Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env),
  },
): string {
  const sections: TerminalSection[] = [];
  const fields = (heading: string, entries: [string, string | undefined][]) => {
    sections.push({
      heading,
      blocks: [
        {
          kind: "fields",
          fields: entries.flatMap(([label, text]) =>
            text
              ? [
                  {
                    label,
                    value: {
                      text,
                      role: [
                        "Branch",
                        "Worktree",
                        "Log",
                        "Pi sessions",
                      ].includes(label)
                        ? ("path" as const)
                        : ("plain" as const),
                    },
                  },
                ]
              : [],
          ),
        },
      ],
    });
  };
  if (display.summary)
    sections.push({
      heading: "Summary",
      blocks: [{ kind: "value", value: { text: display.summary } }],
    });
  if (display.issue)
    fields("Issue and workspace", [
      ["Issue", `#${display.issue.number}`],
      ["Title", display.issue.title],
      ["Outcome", display.outcomeLabel],
      ["Branch", display.facts?.branch],
      ["Worktree", display.facts?.worktree],
    ]);
  if (display.facts?.pullRequest)
    sections.push({
      heading: "Pull request",
      blocks: [
        {
          kind: "value",
          value: { text: display.facts.pullRequest.url, role: "url" },
        },
      ],
    });
  const artifacts = [
    ["Specification", display.facts?.specPath],
    ["Implementation plan", display.facts?.planPath],
  ].flatMap(([label, text]) =>
    text
      ? [
          {
            value: { text: label! },
            details: [{ value: { text, role: "path" as const } }],
          },
        ]
      : [],
  );
  if (artifacts.length)
    sections.push({
      heading: "Artifacts",
      blocks: [{ kind: "list", marker: "•", items: artifacts }],
    });
  const transition = display.transition;
  if (transition)
    fields(
      "Transition",
      transition === "ambiguous-branches"
        ? [["Stopped", "Several issue branches exist"]]
        : transition.kind === "phase"
          ? [["Next phase", transition.phase]]
          : [
              [
                "Next outcome",
                transition.label === "done"
                  ? "Already merged"
                  : "Specification approval required",
              ],
            ],
    );
  if (display.warnings?.length)
    sections.push({
      heading: "Warnings",
      blocks: [
        {
          kind: "list",
          marker: "!",
          markerSeverity: "warning",
          items: display.warnings.map((text) => ({ value: { text } })),
        },
      ],
    });
  if (display.logPath || display.sessionPath)
    fields("Run files", [
      ["Log", display.logPath],
      ["Pi sessions", display.sessionPath],
    ]);
  if (display.cost)
    sections.push({
      heading: "Usage",
      blocks: [{ kind: "value", value: { text: display.cost } }],
    });
  return renderTerminalDocument({
    ...options,
    label: display.label,
    severity: display.severity,
    sections,
    ...(display.usage ? { totalOutputTokens: display.usage.outputTokens } : {}),
    ...(display.elapsedSeconds === undefined
      ? {}
      : { elapsedSeconds: display.elapsedSeconds }),
  });
}

export function formatPhaseStart(phase: Phase, step: number): string {
  return `${String(step).padStart(2, "0")} ${phase}`;
}

export function formatPhaseComplete(
  usage: PiUsage | undefined,
  totalOutputTokens: number,
  elapsedSeconds: number,
): string {
  const tokens = usage
    ? `task ${(usage.outputTokens / 1000).toFixed(1)}k total ${(totalOutputTokens / 1000).toFixed(1)}k`
    : "unavailable";
  return `   tokens: ${tokens}   time elapsed: ${Math.max(0, Math.round(elapsedSeconds))}s`;
}

export function formatRunStart(issue: Issue): string {
  return `issue #${issue.number} · ${cleanValue(issue.title)}`;
}
