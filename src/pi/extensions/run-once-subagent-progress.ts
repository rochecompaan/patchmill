import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSubagentProgressCorrelator } from "../subagent-progress-correlation.ts";
import { SUBAGENT_PROGRESS_CUSTOM_TYPE } from "../subagent-progress.ts";

export { SUBAGENT_PROGRESS_APPEND_ERROR } from "../subagent-progress-correlation.ts";

type SubagentProgressPi = Pick<ExtensionAPI, "on" | "appendEntry">;

/** Pi lifecycle adapter: correlation and validation stay in the focused core. */
export default function runOnceSubagentProgressExtension(
  pi: SubagentProgressPi,
): void {
  const correlator = createSubagentProgressCorrelator({
    append(progress) {
      pi.appendEntry(SUBAGENT_PROGRESS_CUSTOM_TYPE, progress);
    },
  });
  pi.on("session_start", (_event, ctx) => {
    correlator.restore(ctx.sessionManager.getEntries());
  });
  pi.on("tool_execution_update", (event) => {
    if (event.toolName !== "subagent" && event.toolName !== "subagent_wait")
      return;
    correlator.observe({
      phase: "update",
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      result: event.partialResult,
    });
  });
  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "subagent" && event.toolName !== "subagent_wait")
      return;
    correlator.observe({
      phase: "end",
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      result: event.result,
    });
  });
}
