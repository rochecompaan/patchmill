import type { PatchmillConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import { STATE_DIR, stateDir, StateStore } from "../state/store.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import { LocalWorkflowState } from "./local-workflow.ts";
import {
  localWorkSource,
  type LocalWorkSourceInput,
} from "./runner/local-work-source.ts";
import type { WorkSource } from "./runner/shell.ts";
import {
  WORKFLOW_STATUS_TITLES,
  type WorkflowState,
  type WorkflowStatus,
} from "./workflow-state.ts";

export type WorkflowStateInput = {
  config: PatchmillConfig;
  host: Host;
  repoRoot: string;
  now: () => Date;
  warn: (message: string) => void;
};

/** Every mode-dependent answer that commands need, one object per mode. */
export type StateTrackingMode = {
  readonly name: PatchmillConfig["workflow"]["stateTracking"];
  createWorkflowState(input: WorkflowStateInput): WorkflowState;
  /** The names to print for each workflow status. */
  statusTitles(config: PatchmillConfig): Record<WorkflowStatus, string>;
  readonly labelsSetup: { allowed: true } | { allowed: false; reason: string };
  readonly doctorWorkflowCheck: "labels" | "state";
  /** Extra paths that must be ignored by Git in this mode. */
  readonly ignoredStatePaths: readonly string[];
  /** Whether `patchmill run` may start, and the work source it uses. */
  readonly run:
    | {
        allowed: true;
        createWorkSource(input: LocalWorkSourceInput): WorkSource;
      }
    | { allowed: false; reason: string };
};

const LABELS_MODE: StateTrackingMode = {
  name: "labels",
  createWorkflowState: ({ config, host }) =>
    new LabelWorkflowState(host, config.labels),
  statusTitles: (config) => config.labels,
  labelsSetup: { allowed: true },
  doctorWorkflowCheck: "labels",
  ignoredStatePaths: [],
  run: { allowed: true, createWorkSource: localWorkSource },
};

const LOCAL_MODE: StateTrackingMode = {
  name: "local",
  createWorkflowState: ({ host, repoRoot, now, warn }) =>
    new LocalWorkflowState({
      host,
      store: new StateStore(stateDir(repoRoot), warn),
      now,
      warn,
    }),
  statusTitles: () => WORKFLOW_STATUS_TITLES,
  labelsSetup: {
    allowed: false,
    reason: "Local state mode does not use labels.",
  },
  doctorWorkflowCheck: "state",
  ignoredStatePaths: [`${STATE_DIR}/`],
  run: { allowed: true, createWorkSource: localWorkSource },
};

export function stateTrackingMode(config: PatchmillConfig): StateTrackingMode {
  const name = config.workflow.stateTracking;
  switch (name) {
    case "labels":
      return LABELS_MODE;
    case "local":
      return LOCAL_MODE;
    default: {
      const unknown: never = name;
      throw new Error(`Unknown state-tracking mode: ${String(unknown)}`);
    }
  }
}
