import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ConsoleController } from "./controller.ts";

export function registerConsoleTools(
  pi: ExtensionAPI,
  controller: () => ConsoleController,
) {
  const text = (value: string) => ({
    content: [{ type: "text" as const, text: value }],
    details: {},
  });
  pi.registerTool({
    name: "patchmill_submit_planning_result",
    label: "Submit planning result",
    description: "Confirm and submit the planning outcome to Patchmill.",
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal("done"),
        Type.Literal("needs-input"),
        Type.Literal("failed"),
      ]),
      summary: Type.String(),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!(await ctx.ui.confirm("Accept planning result?", params.summary)))
        return text("Not submitted.");
      return text(await controller().submitPlanning(params));
    },
  });
  pi.registerTool({
    name: "patchmill_start_issue_run",
    label: "Start Issue run",
    description: "Claim an Issue on the host and start its run.",
    parameters: Type.Object({ issue: Type.Integer({ minimum: 1 }) }),
    async execute(_id, { issue }, _signal, _update, ctx) {
      if (
        !(await ctx.ui.confirm(
          "Start Issue run?",
          `Claim issue #${issue} on the host`,
        ))
      )
        return text("Not submitted.");
      return text(await controller().startIssueRun(issue));
    },
  });
  pi.registerTool({
    name: "patchmill_continue_issue_run",
    label: "Continue Issue run",
    description: "Recheck a waiting merge and continue the Issue run.",
    parameters: Type.Object({}),
    async execute() {
      return text(await controller().continueRun());
    },
  });
  pi.registerTool({
    name: "patchmill_run_status",
    label: "Issue run status",
    description: "Show the current Issue run, worker, wait and estimated cost.",
    parameters: Type.Object({}),
    async execute() {
      return text(JSON.stringify(controller().status(), null, 2));
    },
  });
  pi.registerTool({
    name: "patchmill_confirm_block_guidance",
    label: "Confirm block guidance",
    description: "Submit guidance for a blocked worker (not yet available).",
    parameters: Type.Object({ text: Type.String() }),
    async execute(_id, { text: guidance }) {
      return text(await controller().confirmGuidance(guidance));
    },
  });
}
