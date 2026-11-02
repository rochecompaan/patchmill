import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PhaseLaunch } from "../kernel/launch.ts";

export type PlanningDialogFacts = {
  issue: { number: number; title: string };
  stage: "spec" | "plan" | "implementation";
  branch: string;
  commit: string;
  specPath?: string | undefined;
  planPath?: string | undefined;
  mockupPath?: string | undefined;
  earlierStage?: "spec" | "plan";
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function prose(value: string, limit: number): string {
  const normalized = stripTerminalSequences(value).replace(/\s+/g, " ").trim();
  if (Array.from(normalized).length <= limit) return normalized;
  let result = "";
  let length = 0;
  for (const { segment } of graphemes.segment(normalized)) {
    length += Array.from(segment).length;
    if (length >= limit) break;
    result += segment;
  }
  return `${result}…`;
}

function fitLine(value: string, width: number): string {
  return stripTerminalSequences(truncateToWidth(value, width, "…"));
}

export function renderPlanningDialog(
  facts: PlanningDialogFacts,
  gate: PhaseLaunch["planningGate"],
  highlights: string[],
  viewport = { columns: 80, rows: 24 },
): { title: string; options: string[]; notification?: string } {
  // Pi's selector adds one column of padding on each side. The tool supplies
  // the current terminal size; non-terminal callers can use the 80×24 default.
  const width = viewport.columns - 2;
  const subject = gate?.required
    ? facts.stage
    : facts.specPath && facts.planPath
      ? "spec and plan"
      : facts.specPath
        ? "spec"
        : "plan";
  const prefix = `${gate?.required ? "Approve" : "Have you reviewed"} the ${subject} for issue #${facts.issue.number}: `;
  const question = `${prefix}${fitLine(prose(facts.issue.title, 60), Math.max(1, width - visibleWidth(prefix) - 1))}?`;
  const options = [
    ...(gate?.required
      ? gate.pullRequest
        ? [
            "Approve and open a planning PR",
            "Approve without a PR (continue now)",
          ]
        : ["Approve (continue now)"]
      : ["Reviewed, continue"]),
    "Request changes",
  ];
  const points = highlights.map(
    (line) => `  • ${fitLine(prose(line, 72), width - 4)}`,
  );
  let mockup = facts.mockupPath;
  const title = () =>
    [
      question,
      "",
      ...(facts.specPath ? [`  Spec     ${facts.specPath}`] : []),
      ...(facts.planPath ? [`  Plan     ${facts.planPath}`] : []),
      ...(mockup ? [`  Mockup   ${mockup}`] : []),
      `  Branch   ${fitLine(prose(facts.branch, width), width - 14 - visibleWidth(facts.commit))} @ ${facts.commit}`,
      ...(points.length ? ["", "  Key points", ...points] : []),
      ...(gate?.required && !gate.pullRequest && facts.earlierStage
        ? [
            "",
            ...wrapTextWithAnsi(
              `A planning PR isn't offered: it would also carry the ${facts.earlierStage}, which was approved without a PR.`,
              width,
            ),
          ]
        : []),
    ].join("\n");
  const fullDetails = title();
  // Reserve selector borders/spacers/key hints (7), transcript (1), the default
  // above-editor spacer (1), and footer incl. an extension-status row (3).
  const available = viewport.rows - 12 - options.length;
  const fits = () => wrapTextWithAnsi(title(), width).length <= available;
  while (!fits() && points.length) points.pop();
  if (!fits()) mockup = undefined;
  if (!fits()) return { title: question, options, notification: fullDetails };
  return { title: title(), options };
}
