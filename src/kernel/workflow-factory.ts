import type { PatchmillConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import { stateDir, StateStore } from "../state/store.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import { LocalWorkflowState } from "./local-workflow.ts";
import type { WorkflowState } from "./workflow-state.ts";

export function createWorkflowState(input: {
  config: PatchmillConfig;
  host: Host;
  repoRoot: string;
  now: () => Date;
  warn: (message: string) => void;
}): WorkflowState {
  const { config, host, repoRoot, now, warn } = input;
  return config.workflow.stateTracking === "local"
    ? new LocalWorkflowState({
        host,
        store: new StateStore(stateDir(repoRoot), warn),
        now,
        warn,
      })
    : new LabelWorkflowState(host, config.labels);
}
