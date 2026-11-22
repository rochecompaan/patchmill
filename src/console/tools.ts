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
      "Submit the planning outcome for maintainer review. Supply 2–5 single-line highlights (at most 72 characters each) of the document’s main decisions, with no file paths, branch, commit or check results. Keep the full result in summary (not displayed in the dialog).",
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal("done"),
        Type.Literal("needs-input"),
        Type.Literal("failed"),
      ]),
      summary: Type.String(),
      highlights: Type.Array(Type.String({ maxLength: 72 }), {
        minItems: 2,
        maxItems: 5,
      }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const current = controller();
      const gate = current.planningGate();
      const facts = await current.planningDialogFacts();
      if (!facts)
        return text("Patchmill is not waiting for a planning result.");
      const dimension = (value: number | undefined, fallback: number) =>
        typeof value === "number" && Number.isFinite(value) && value > 0
          ? value
          : fallback;
      const dialog = renderPlanningDialog(facts, gate, params.highlights, {
        columns: dimension(process.stdout.columns, 80),
        rows: dimension(process.stdout.rows, 24),
      });
      if (dialog.notification) ctx.ui.notify(dialog.notification, "info");
      const choice = await ctx.ui.select(dialog.title, dialog.options);
      if (
        !choice ||
        choice === "Request changes" ||
        !dialog.options.includes(choice)
      )
        return text("Not submitted. Ask the maintainer what to change.");
      // An ungated review is a chat approval too: Patchmill then pushes.
      const approval =
        gate?.required && choice === "Approve and open a planning PR"
          ? "pr"
          : "no-pr";
      return text(await current.submitPlanning(params, approval));
    },
  });
  pi.registerTool({
    name: "patchmill_continue_issue_run",
    label: "Continue Issue run",
    description: "Recheck a waiting merge and continue the Issue run.",
    promptGuidelines: [
      "In a review wait, the maintainer reviews and merges the pull request. Patchmill does not detect the merge by itself. Call `patchmill_continue_issue_run` when the maintainer says that the pull request is merged or asks you to check again.",
      "When the maintainer asks for pull request changes during a review wait, make them yourself. Never tell the maintainer to edit the code. Get the worktree, branch and pull request from `patchmill_run_status` (`snapshot.facts`). Work only in that worktree.",
      "For those changes, follow the rules of the patchmill-implementation skill for a revision of a ready pull request. Run the repository checks, commit, and push to the issue branch. Never force-push. Keep the pull request ready, and keep its closing reference. Never merge the pull request.",
      "After you push, tell the maintainer what changed. Then tell them to merge the pull request and tell you to continue.",
      "After the run ends, use `ended` from `patchmill_run_status` to say what to do next. Do not call `patchmill_continue_issue_run` for a run that has ended.",
      "When an end-of-run message says that you explain the problem, do it at once. Read the summary and the messages before it. Say in plain words what went wrong and how you can resolve it, and offer to do it. Do not only tell the maintainer to read the summary.",
      "Resolve a problem after the run only when the maintainer agrees. Work only in the issue worktree. Never discard uncommitted changes, and never remove a worktree or branch that Patchmill kept, unless the maintainer has seen exactly what would be lost. Never merge, force-push, or push the base branch. Never change issue labels: the kernel owns the run state.",
      "After the fix, tell the maintainer the next step. For a stopped or failed run: quit, and run `patchmill run-once --interactive --issue <N>`. For a cleanup that did not finish: Patchmill tries cleanup again at its next run start.",
    ],
    parameters: Type.Object({}),
    async execute() {
      return text(await controller().continueRun());
    },
  });
  pi.registerTool({
    name: "patchmill_run_status",
    label: "Issue run status",
    description:
      "Show the current or ended Issue run, worker, wait and estimated cost.",
    promptGuidelines: [
      "When you answer a Patchmill worker's supervisor request with `subagent_supervisor`, never tell the worker to yield, to end its turn, or to end without its JSON result. A worker runs as a subagent: its run ends with its turn, and nothing wakes it later.",
      "Tell the worker to wait for its own subagent runs in the same turn with `bg_wait({ id })`, and then to finish with its JSON result.",
    ],
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
