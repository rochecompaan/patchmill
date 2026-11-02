import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderPlanningDialog } from "./planning-dialog.ts";
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
    description:
      "Submit the planning outcome for maintainer review. Supply 2–5 short highlights of the document’s main decisions, with no file paths, branch, commit or check results. Keep the full result in summary (not displayed in the dialog).",
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal("done"),
        Type.Literal("needs-input"),
        Type.Literal("failed"),
      ]),
      summary: Type.String(),
      highlights: Type.Array(Type.String(), { minItems: 2, maxItems: 5 }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const current = controller();
      const gate = current.planningGate();
      const facts = await current.planningDialogFacts();
      if (!facts)
        return text("Patchmill is not waiting for a planning result.");
      const dialog = renderPlanningDialog(facts, gate, params.highlights);
      const choice = await ctx.ui.select(dialog.title, dialog.options);
      if (
        !choice ||
        choice === "Request changes" ||
        !dialog.options.includes(choice)
      )
        return text("Not submitted. Ask the maintainer what to change.");
      const approval = gate?.required
        ? choice === "Approve and open a planning PR"
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
