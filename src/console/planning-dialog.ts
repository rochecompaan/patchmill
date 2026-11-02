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

export function renderPlanningDialog(
  facts: PlanningDialogFacts,
  gate: PhaseLaunch["planningGate"],
  highlights: string[],
) {
  const subject = gate?.required
    ? facts.stage
    : facts.specPath && facts.planPath
      ? "spec and plan"
      : facts.specPath
        ? "spec"
        : "plan";
  const question = `${gate?.required ? "Approve" : "Have you reviewed"} the ${subject} for issue #${facts.issue.number}: ${facts.issue.title}?`;
  const details = [
    ...(facts.specPath ? [`  Spec     ${facts.specPath}`] : []),
    ...(facts.planPath ? [`  Plan     ${facts.planPath}`] : []),
    ...(facts.mockupPath ? [`  Mockup   ${facts.mockupPath}`] : []),
    `  Branch   ${facts.branch} @ ${facts.commit}`,
    "",
    "  Key points",
    ...highlights.map((line) => `  • ${line}`),
    ...(gate?.required && !gate.pullRequest && facts.earlierStage
      ? [
          "",
          `A planning PR isn't offered: it would also carry the ${facts.earlierStage}, which was approved without a PR.`,
        ]
      : []),
  ];
  return {
    title: [question, "", ...details].join("\n"),
    options: [
      ...(gate?.required
        ? gate.pullRequest
          ? [
              "Approve and open a planning PR",
              "Approve without a PR (continue now)",
            ]
          : ["Approve (continue now)"]
        : ["Reviewed, continue"]),
      "Request changes",
    ],
  };
}
