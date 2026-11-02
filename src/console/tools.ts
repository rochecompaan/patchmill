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
      const current = controller();
      const gate = current.planningGate();
      if (
        !(await ctx.ui.confirm(
          gate?.required ? "Approve?" : "Accept planning result?",
          params.summary,
        ))
      )
        return text("Not submitted. Ask the maintainer what to change.");
      const approval = gate?.required
        ? gate.pullRequest &&
          (await ctx.ui.confirm(
            "Open a planning pull request?",
            "Choosing no PR continues with the approved documents in the implementation PR.",
          ))
          ? "pr"
          : "no-pr"
        : undefined;
      return text(await current.submitPlanning(params, approval));
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
    description: "Confirm and submit guidance for a blocked worker.",
    parameters: Type.Object({ guidance: Type.String() }),
    async execute(_id, { guidance }, _signal, _update, ctx) {
      if (!(await ctx.ui.confirm("Send guidance to the worker?", guidance)))
        return text("Not submitted.");
      return text(await controller().confirmGuidance(guidance));
    },
  });
}
