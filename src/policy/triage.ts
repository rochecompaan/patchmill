import type {
  PatchmillLabelsConfig,
  PatchmillTriageConfig,
} from "../config/types.ts";
import type { LabelDefinition } from "../host/types.ts";
import {
  cloneTriageStateMap,
  defaultTriageStateMap,
  nonReadyStateLabels,
  type PatchmillTriageStateMap,
} from "./triage-state.ts";
import { automationProtectionLabels, requiredLabels } from "./labels.ts";

export type PatchmillTriagePolicy = {
  labels: {
    ready: string;
    needsInfo: string;
    unsuitable: string;
    inProgress: string;
    done: string;
    blocked: string;
    types: string[];
    priorities: string[];
  };
  stateMap: PatchmillTriageStateMap;
  allowedLabels: LabelDefinition[];
  excludedLabels: string[];
  runOnceSelection: {
    readyLabel: string;
    excludedLabels: string[];
    priorityOrder: string[];
  };
};

export function createTriagePolicy(
  config: PatchmillLabelsConfig,
  triageConfig?: PatchmillTriageConfig,
): PatchmillTriagePolicy {
  const labels = {
    ready: config.ready,
    needsInfo: config.needsInfo,
    unsuitable: config.unsuitable,
    inProgress: config.inProgress,
    done: config.done,
    blocked: config.blocked,
    types: [...config.types],
    priorities: [...config.priorities],
  };
  const allowedLabels = requiredLabels(config);
  const stateMap = triageConfig?.stateMap
    ? cloneTriageStateMap(triageConfig.stateMap)
    : defaultTriageStateMap(config);
  const stateBlockedLabels = nonReadyStateLabels(stateMap);
  const excludedLabels = [...automationProtectionLabels(config)];

  return {
    labels,
    stateMap,
    allowedLabels,
    excludedLabels,
    runOnceSelection: {
      readyLabel: config.ready,
      excludedLabels: [
        ...new Set([
          ...excludedLabels.filter((label) => label !== config.ready),
          ...stateBlockedLabels,
        ]),
      ],
      priorityOrder: [...config.priorities],
    },
  };
}
