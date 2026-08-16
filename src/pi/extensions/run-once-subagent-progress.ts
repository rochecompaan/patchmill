import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  parseSubagentProgressResults,
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type SubagentProgress,
} from "../subagent-progress.ts";

export const SUBAGENT_PROGRESS_APPEND_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED";

type SubagentProgressPi = Pick<ExtensionAPI, "on" | "appendEntry">;
type ChildState = { keys: Set<string> };
type ParentState = Map<number, ChildState>;

type ObservedToolEvent = {
  toolCallId: string;
  toolName: string;
};

function limitExceeded(): never {
  throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
}

export default function runOnceSubagentProgressExtension(
  pi: SubagentProgressPi,
): void {
  const parents = new Map<string, ParentState>();
  let activeChildren = 0;
  let activeKeys = 0;
  let sessionEntries = 0;

  function appendProgress(progress: SubagentProgress): void {
    let parent = parents.get(progress.toolCallId);
    const needsParent = parent === undefined;
    if (
      needsParent &&
      parents.size >= SUBAGENT_PROGRESS_LIMITS.maxActiveParents
    ) {
      limitExceeded();
    }
    parent ??= new Map<number, ChildState>();

    let child = parent.get(progress.childIndex);
    const needsChild = child === undefined;
    if (
      needsChild &&
      (parent.size >= SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
        activeChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren)
    ) {
      limitExceeded();
    }
    child ??= { keys: new Set<string>() };

    const key = subagentProgressKey(progress);
    if (child.keys.has(key)) return;
    if (
      child.keys.size >= SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild ||
      activeKeys >= SUBAGENT_PROGRESS_LIMITS.maxActiveKeys ||
      sessionEntries >= SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession
    ) {
      limitExceeded();
    }

    try {
      pi.appendEntry(SUBAGENT_PROGRESS_CUSTOM_TYPE, progress);
    } catch (cause) {
      throw new Error(SUBAGENT_PROGRESS_APPEND_ERROR, { cause });
    }

    if (needsParent) parents.set(progress.toolCallId, parent);
    if (needsChild) {
      parent.set(progress.childIndex, child);
      activeChildren += 1;
    }
    child.keys.add(key);
    activeKeys += 1;
    sessionEntries += 1;
  }

  function appendResult(event: ObservedToolEvent, result: unknown): void {
    for (const progress of parseSubagentProgressResults(
      result,
      event.toolCallId,
    )) {
      appendProgress(progress);
    }
  }

  function releaseParent(toolCallId: string): void {
    const parent = parents.get(toolCallId);
    if (!parent) return;
    for (const child of parent.values()) activeKeys -= child.keys.size;
    activeChildren -= parent.size;
    parents.delete(toolCallId);
  }

  pi.on("session_start", (_event, ctx) => {
    parents.clear();
    activeChildren = 0;
    activeKeys = 0;
    sessionEntries = ctx.sessionManager
      .getEntries()
      .filter(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === SUBAGENT_PROGRESS_CUSTOM_TYPE,
      ).length;
  });
  pi.on("tool_execution_update", (event) => {
    if (event.toolName !== "subagent") return;
    appendResult(event, event.partialResult);
  });
  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "subagent") return;
    appendResult(event, event.result);
    releaseParent(event.toolCallId);
  });
}
