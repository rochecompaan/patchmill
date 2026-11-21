import {
  stateTrackingMode,
  type WorkflowStateInput,
} from "./state-tracking-mode.ts";
import type { WorkflowState } from "./workflow-state.ts";

export function createWorkflowState(input: WorkflowStateInput): WorkflowState {
  return stateTrackingMode(input.config).createWorkflowState(input);
}
