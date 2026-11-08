import { resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import { STATE_DIR, StateStore } from "../state/store.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import { LocalWorkflowState } from "./local-workflow.ts";
import type { WorkflowState } from "./workflow-state.ts";

export function createWorkflowState(
  config: PatchmillConfig,
  host: Host,
  repoRoot: string,
  now: () => Date,
  warn: (message: string) => void,
): WorkflowState {
  return config.workflow.stateTracking === "local"
    ? new LocalWorkflowState({
        host,
        store: new StateStore(resolve(repoRoot, STATE_DIR), warn),
        now,
        warn,
      })
    : new LabelWorkflowState(host, config.labels);
}
