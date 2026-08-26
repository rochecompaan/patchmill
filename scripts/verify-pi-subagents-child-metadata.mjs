#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInstalledPiSubagentsMatchesRootPin,
  piSubagentsExtensionFiles,
  readRootPiSubagentsPin,
  resolvePiSubagentsPackageRoot,
} from "../src/pi/pi-subagents-package.ts";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function collectSubagentEvents(events) {
  const subagentFinals = events.filter(
    (event) =>
      event.type === "tool_execution_end" && event.toolName === "subagent",
  );
  return {
    partials: events
      .filter(
        (event) =>
          event.type === "tool_execution_update" &&
          event.toolName === "subagent",
      )
      .map((event) => event.partialResult),
    finals: subagentFinals
      .filter(
        (event) => event.isError !== true && event.result?.isError !== true,
      )
      .map((event) => event.result),
    failures: subagentFinals.filter(
      (event) => event.isError === true || event.result?.isError === true,
    ),
  };
}

function childRows(result) {
  if (Array.isArray(result?.details?.results)) return result.details.results;
  throw new Error("subagent result missing details.results child rows");
}

function resultRunId(result) {
  const runId = result?.details?.runId;
  if (typeof runId === "string" && runId.trim().length > 0) return runId;
  throw new Error("subagent result missing details.runId");
}

function childIdentity(row) {
  return Number.isSafeInteger(row?.index) && row.index >= 0
    ? row.index
    : undefined;
}

function validateChild({
  child,
  id,
  label,
  expectedModel,
  expectedThinking,
  requireThinking,
  partial,
}) {
  const prefix = partial ? "partial child" : "child";
  if (id === undefined) {
    throw new Error(`${label}: ${prefix} missing upstream identity`);
  }
  if (child?.exitCode !== undefined && child.exitCode !== 0) {
    throw new Error(
      `${label}: ${prefix} ${id} exited with code ${child.exitCode}`,
    );
  }
  if (child?.model !== expectedModel) {
    throw new Error(`${label}: ${prefix} ${id} missing model ${expectedModel}`);
  }
  if (requireThinking && child?.thinking !== expectedThinking) {
    throw new Error(
      `${label}: ${prefix} ${id} missing thinking ${expectedThinking}`,
    );
  }
  if (!requireThinking && "thinking" in child) {
    throw new Error(
      `${label}: ${prefix} ${id} expected thinking absence but found ${child.thinking}`,
    );
  }
}

function assertPartialIdsInFinalOrder(label, partialIds, finalIds) {
  let searchStart = 0;
  for (const partialId of partialIds) {
    const finalIndex = finalIds.indexOf(partialId, searchStart);
    if (finalIndex === -1) {
      throw new Error(
        `${label}: partial child identity ${partialId} missing from final children or out of order`,
      );
    }
    searchStart = finalIndex + 1;
  }
}

export function validateShapeContract(options) {
  assert.equal(
    options.shape.failures?.length ?? 0,
    0,
    `${options.label}: expected no failed subagent tool results`,
  );
  assert.equal(
    options.shape.finals.length,
    1,
    `${options.label}: expected exactly one final subagent tool result`,
  );
  const finalRunId = resultRunId(options.shape.finals[0]);
  const finalChildren = options.shape.finals.flatMap(childRows);
  if (finalChildren.length !== options.expectedFinalChildren) {
    throw new Error(
      `${options.label}: expected exactly ${options.expectedFinalChildren} final children, got ${finalChildren.length}`,
    );
  }
  const finalIds = finalChildren.map(childIdentity);
  finalChildren.forEach((child, index) =>
    validateChild({
      child,
      id: finalIds[index],
      label: options.label,
      expectedModel: options.expectedModel,
      expectedThinking: options.expectedThinking,
      requireThinking: options.requireThinking,
      partial: false,
    }),
  );
  if (
    options.requireUniqueSiblingIds &&
    new Set(finalIds).size !== finalIds.length
  ) {
    throw new Error(
      `${options.label}: duplicate upstream identity in final children`,
    );
  }
  if (options.shape.partials.length === 0) {
    console.log(`${options.label}: upstream emitted no partial results`);
  }
  for (const partial of options.shape.partials) {
    const partialRunId = resultRunId(partial);
    if (partialRunId !== finalRunId) {
      throw new Error(
        `${options.label}: partial runId ${partialRunId} does not match final runId ${finalRunId}`,
      );
    }
    const partialChildren = childRows(partial);
    const partialIds = partialChildren.map(childIdentity);
    if (partialIds.length === 0) {
      console.log(`${options.label}: partial result contained no child rows`);
      continue;
    }
    partialChildren.forEach((child, index) =>
      validateChild({
        child,
        id: partialIds[index],
        label: options.label,
        expectedModel: options.expectedModel,
        expectedThinking: options.expectedThinking,
        requireThinking: options.requireThinking,
        partial: true,
      }),
    );
    assertPartialIdsInFinalOrder(options.label, partialIds, finalIds);
  }
}

/** Validate the structured single-child contract without inferring identity from row order. */
export function validateDirectShapeContract(options) {
  return validateShapeContract({
    ...options,
    requireUniqueSiblingIds: options.requireUniqueSiblingIds ?? false,
  });
}

/** Validates a structured async launch and its documented wait completion. */
export function validateDirectAsyncShapeContract({
  label,
  events,
  expectedModel,
  expectedThinking,
  requireThinking,
}) {
  const launch = events.find(
    (event) =>
      event.type === "tool_execution_end" &&
      event.toolName === "subagent" &&
      typeof event.result?.details?.asyncId === "string",
  );
  if (!launch) throw new Error(`${label}: missing structured async launch`);
  const asyncId = launch.result.details.asyncId;
  const waitEvents = events.filter(
    (event) =>
      event.type === "tool_execution_end" && event.toolName === "subagent_wait",
  );
  if (
    waitEvents.some(
      (event) => event.isError === true || event.result?.isError === true,
    )
  )
    throw new Error(`${label}: async wait tool failed`);
  const completion = waitEvents
    .flatMap((event) => event.result?.details?.completions ?? [])
    .find((row) => row?.runId === asyncId);
  if (!completion)
    throw new Error(`${label}: missing wait completion for ${asyncId}`);
  if (completion.success === false || completion.state === "failed")
    throw new Error(`${label}: async completion failed`);
  const rows = completion.results;
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error(`${label}: completion missing direct child`);
  const child = rows[0];
  if (child?.success === false)
    throw new Error(`${label}: completion child failed`);
  if (typeof child?.agent !== "string")
    throw new Error(`${label}: completion child missing canonical agent`);
  if (expectedModel && child.model !== expectedModel)
    throw new Error(
      `${label}: completion child missing model ${expectedModel}`,
    );
  // WaitCompletionChild deliberately omits index and thinking in v0.57.0;
  // correlation retains the launch (asyncId, index 0) identity instead.
  void expectedThinking;
  void requireThinking;
}

/**
 * Independently validates the released workflowChildren v1 contract. This
 * intentionally does not import Patchmill's production parser.
 */
export function validateWorkflowShapeContract({
  label,
  events,
  parentToolCallId,
  expectedChildIds,
  expectedModel,
  expectedThinking,
  requireThinking = true,
}) {
  const summaries = [];
  for (const event of events) {
    if (event?.isError === true || event?.result?.isError === true)
      throw new Error(`${label}: workflow tool failed`);
    const details = event?.partialResult?.details ?? event?.result?.details;
    if (details?.workflowChildren) summaries.push(details.workflowChildren);
    if (Array.isArray(details?.completions)) {
      for (const completion of details.completions) {
        if (completion?.workflowChildren)
          summaries.push(completion.workflowChildren);
      }
    }
  }
  if (summaries.length === 0)
    throw new Error(`${label}: missing workflowChildren summary`);
  let runId;
  let previousIds = new Set();
  for (const summary of summaries) {
    if (summary?.version !== 1)
      throw new Error(`${label}: unsupported workflow summary version`);
    if (
      parentToolCallId !== undefined &&
      summary.parentToolCallId !== parentToolCallId
    )
      throw new Error(`${label}: workflow parent drift`);
    if (
      typeof summary.workflowRunId !== "string" ||
      !summary.workflowRunId.trim()
    )
      throw new Error(`${label}: missing workflow run id`);
    if (runId && runId !== summary.workflowRunId)
      throw new Error(`${label}: workflow run drift`);
    runId = summary.workflowRunId;
    if (!Array.isArray(summary.children))
      throw new Error(`${label}: workflow children missing`);
    const ids = new Set();
    const closes =
      summary.inventoryComplete === true ||
      ["completed", "failed", "stopped"].includes(summary.workflowState);
    for (const child of summary.children) {
      if (
        typeof child?.childId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(child.childId) ||
        ids.has(child.childId)
      )
        throw new Error(`${label}: invalid or duplicate workflow child id`);
      ids.add(child.childId);
      if (child.state === "failed")
        throw new Error(`${label}: child ${child.childId} failed`);
      if (closes && typeof child.agent !== "string")
        throw new Error(
          `${label}: child ${child.childId} missing canonical agent`,
        );
      if (closes && expectedModel && child.model !== expectedModel)
        throw new Error(
          `${label}: child ${child.childId} missing model ${expectedModel}`,
        );
      if (
        closes &&
        requireThinking &&
        expectedThinking &&
        child.thinking !== expectedThinking
      )
        throw new Error(
          `${label}: child ${child.childId} missing thinking ${expectedThinking}`,
        );
      if (closes && !requireThinking && "thinking" in child)
        throw new Error(
          `${label}: child ${child.childId} unexpectedly includes thinking`,
        );
    }
    for (const id of previousIds)
      if (!ids.has(id) && summary.inventoryComplete !== true)
        throw new Error(`${label}: open inventory removed ${id}`);
    previousIds = ids;
  }
  const final = summaries.at(-1);
  if (
    !final.inventoryComplete &&
    !["completed", "failed", "stopped"].includes(final.workflowState)
  )
    throw new Error(`${label}: workflow inventory never closed`);
  if (expectedChildIds) {
    assert.deepEqual(
      [...previousIds].sort(),
      [...expectedChildIds].sort(),
      `${label}: stable child ID mismatch`,
    );
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for live child metadata validation`);
  return value;
}

// pi-subagents reports the exact Pi model argument it launches. This fixture
// explicitly selects its thinking level instead of relying on parent settings.
export function reportedThinkingModel(model, thinking) {
  return `${model}:${thinking}`;
}

function agentDefinition({ name, model, thinking }) {
  return `---\nname: ${name}\ndescription: Contract fixture agent for pi-subagents metadata validation\nmodel: ${model}\n${thinking ? `thinking: ${thinking}\n` : ""}tools: bash\nsystemPromptMode: replace\ninheritProjectContext: false\ninheritSkills: false\n---\n\nReturn exactly the short text requested by the parent. Do not call tools.\n`;
}

function parseJsonLines(output, label) {
  const events = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Pi may emit non-protocol diagnostics on stderr; stdout protocol rows are JSON.
      throw new Error(`${label}: Pi emitted non-JSON stdout: ${line}`);
    }
  }
  return events;
}

function runShape({
  label,
  input,
  expectedFinalChildren,
  expectedModel,
  expectedThinking,
  requireThinking,
  cwd,
  agentsDir,
  packageRoot,
  parentModel,
  expectedChildIds,
  asyncWait = false,
}) {
  const args = [
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--approve",
    "--no-context-files",
    "-ne",
    "--no-prompt-templates",
    "-e",
    packageRoot,
  ];
  if (parentModel) args.push("--model", parentModel);
  args.push(
    asyncWait
      ? `Launch this subagent input exactly once, capture its returned async run ID, then call subagent_wait exactly once with that ID and stop:\n${JSON.stringify(input)}`
      : `Call the subagent tool exactly once with this input and then stop:\n${JSON.stringify(input)}`,
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("PI_SUBAGENT_"),
    ),
  );
  environment.PI_SUBAGENT_EXTRA_AGENT_DIRS = agentsDir;
  const result = spawnSync(join(rootDir, "node_modules", ".bin", "pi"), args, {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const rawOutput = `${result.stdout}\n${result.stderr}`;
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label}: Pi command failed: ${result.error?.message ?? `exit ${result.status}`}\n${rawOutput}`,
    );
  }
  const events = parseJsonLines(result.stdout, label);
  const shape = collectSubagentEvents(events);
  try {
    if (asyncWait && !expectedChildIds) {
      validateDirectAsyncShapeContract({
        label,
        events,
        expectedModel,
        expectedThinking,
        requireThinking,
      });
    } else if (expectedChildIds) {
      const launchEvent = events.find(
        (event) =>
          event.type === "tool_execution_update" &&
          event.toolName === "subagent" &&
          typeof event.toolCallId === "string",
      );
      validateWorkflowShapeContract({
        label,
        events,
        parentToolCallId: launchEvent?.toolCallId,
        expectedChildIds,
        expectedModel,
        expectedThinking,
        requireThinking,
      });
    } else {
      validateDirectShapeContract({
        label,
        expectedModel,
        expectedThinking,
        expectedFinalChildren,
        requireUniqueSiblingIds: expectedFinalChildren > 1,
        requireThinking,
        shape,
      });
    }
  } catch (error) {
    throw new Error(
      `${label}: ${error instanceof Error ? error.message : String(error)}\nRaw Pi output:\n${rawOutput}`,
    );
  }
  console.log(
    `${label}: ${requireThinking ? "metadata contract passed" : "absence contract passed"}`,
  );
}

async function main() {
  readRootPiSubagentsPin(join(rootDir, "package.json"));
  assertInstalledPiSubagentsMatchesRootPin(join(rootDir, "package.json"));
  piSubagentsExtensionFiles();
  const packageRoot = resolvePiSubagentsPackageRoot();
  const model = requiredEnvironment("PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL");
  const thinking =
    process.env.PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING ?? "low";
  const noThinkingModel = requiredEnvironment(
    "PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL",
  );
  const parentModel = process.env.PATCHMILL_PI_SUBAGENTS_PARENT_MODEL;
  const cwd = await mkdtemp(join(tmpdir(), "patchmill-pi-subagents-contract-"));
  try {
    const agentsDir = join(cwd, ".pi", "agents");
    const legacyAgentsDir = join(cwd, ".agents");
    await Promise.all([
      mkdir(agentsDir, { recursive: true }),
      mkdir(legacyAgentsDir),
    ]);
    const thinkingAgent = agentDefinition({
      name: "contract-thinking",
      model,
      thinking,
    });
    const noThinkingAgent = agentDefinition({
      name: "contract-no-thinking",
      model: noThinkingModel,
    });
    await Promise.all([
      writeFile(join(agentsDir, "contract-thinking.md"), thinkingAgent),
      writeFile(join(agentsDir, "contract-no-thinking.md"), noThinkingAgent),
      writeFile(join(legacyAgentsDir, "contract-thinking.md"), thinkingAgent),
      writeFile(
        join(legacyAgentsDir, "contract-no-thinking.md"),
        noThinkingAgent,
      ),
    ]);
    const common = {
      cwd,
      agentsDir,
      packageRoot,
      expectedModel: reportedThinkingModel(model, thinking),
      expectedThinking: thinking,
      requireThinking: true,
      parentModel,
    };
    runShape({
      ...common,
      label: "direct",
      expectedFinalChildren: 1,
      input: {
        agent: "contract-thinking",
        task: "Return the word direct.",
        context: "fresh",
      },
    });
    runShape({
      ...common,
      label: "direct-async",
      expectedFinalChildren: 1,
      asyncWait: true,
      input: {
        agent: "contract-thinking",
        task: "Return the word direct async.",
        async: true,
        context: "fresh",
      },
    });
    const workflows = [
      [
        "workflow-runs-run",
        ["single"],
        'return await runs.run("single", {agent:"contract-thinking", task:"Return workflow single."});',
      ],
      [
        "workflow-runs-all",
        ["parallel-a", "parallel-b"],
        'return await runs.all([{key:"parallel-a",agent:"contract-thinking",task:"Return parallel a."},{key:"parallel-b",agent:"contract-thinking",task:"Return parallel b."}]);',
      ],
      [
        "workflow-sequential",
        ["first", "second"],
        'await runs.run("first",{agent:"contract-thinking",task:"Return first."}); return await runs.run("second",{agent:"contract-thinking",task:"Return second."});',
      ],
      [
        "workflow-dynamic",
        ["dynamic-a", "dynamic-b"],
        'const keys=["dynamic-a","dynamic-b"]; for(const key of keys){await runs.run(key,{agent:"contract-thinking",task:`Return ${key}.`});} return keys;',
      ],
    ];
    for (const [label, expectedChildIds, workflowScript] of workflows) {
      runShape({
        ...common,
        label,
        expectedFinalChildren: 0,
        expectedChildIds,
        input: { workflowScript, async: false, context: "fresh" },
      });
    }
    runShape({
      ...common,
      label: "workflow-async",
      expectedFinalChildren: 0,
      expectedChildIds: ["parallel-a", "parallel-b"],
      asyncWait: true,
      input: {
        workflowScript:
          'return await runs.all([{key:"parallel-a",agent:"contract-thinking",task:"Return parallel a."},{key:"parallel-b",agent:"contract-thinking",task:"Return parallel b."}]);',
        async: true,
        context: "fresh",
      },
    });
    runShape({
      cwd,
      agentsDir,
      packageRoot,
      parentModel,
      label: "no-thinking",
      expectedFinalChildren: 1,
      expectedModel: noThinkingModel,
      requireThinking: false,
      input: {
        agent: "contract-no-thinking",
        task: "Return the words no thinking.",
        context: "fresh",
      },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
