#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export function collectSubagentEvents(events) {
  return {
    partials: events
      .filter(
        (event) =>
          event.type === "tool_execution_update" && event.toolName === "subagent",
      )
      .map((event) => event.partialResult),
    finals: events
      .filter(
        (event) =>
          event.type === "tool_execution_end" &&
          event.toolName === "subagent" &&
          event.isError !== true,
      )
      .map((event) => event.result),
  };
}

function childRows(result) {
  if (Array.isArray(result?.details?.results)) return result.details.results;
  throw new Error("subagent result missing details.results child rows");
}

function childIdentity(row) {
  return Number.isSafeInteger(row?.index) && row.index >= 0
    ? row.index
    : undefined;
}

function validateChild({ child, id, label, expectedModel, expectedThinking, requireThinking, partial }) {
  const prefix = partial ? "partial child" : "child";
  if (id === undefined) {
    throw new Error(`${label}: ${prefix} missing upstream identity`);
  }
  if (child?.model !== expectedModel) {
    throw new Error(`${label}: ${prefix} ${id} missing model ${expectedModel}`);
  }
  if (requireThinking && child?.thinking !== expectedThinking) {
    throw new Error(`${label}: ${prefix} ${id} missing thinking ${expectedThinking}`);
  }
  if (!requireThinking && "thinking" in child) {
    throw new Error(`${label}: ${prefix} ${id} expected thinking absence but found ${child.thinking}`);
  }
}

export function validateShapeContract(options) {
  assert.equal(
    options.shape.finals.length,
    1,
    `${options.label}: expected exactly one final subagent tool result`,
  );
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
    throw new Error(`${options.label}: duplicate upstream identity in final children`);
  }
  if (options.shape.partials.length === 0) {
    console.log(`${options.label}: upstream emitted no partial results`);
  }
  for (const partial of options.shape.partials) {
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
    assert.deepEqual(
      partialIds,
      finalIds.slice(0, partialIds.length),
      `${options.label}: partial and final child ordering differs`,
    );
  }
}

function readRootPin() {
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const pin = packageJson.dependencies?.["pi-subagents"];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pin ?? "")) {
    throw new Error(`pi-subagents must be an exact root pin; found ${pin ?? "missing"}`);
  }
  return pin;
}

function resolvePiSubagentsRoot() {
  return dirname(require.resolve("pi-subagents"));
}

function assertInstalledPackage(pin, packageRoot) {
  const manifestPath = join(packageRoot, "package.json");
  if (!existsSync(manifestPath)) throw new Error(`missing pi-subagents manifest: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== pin) {
    throw new Error(`pi-subagents resolved ${manifest.version} but root pins ${pin}`);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for live child metadata validation`);
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

function runShape({ label, input, expectedFinalChildren, expectedModel, expectedThinking, requireThinking, cwd, agentsDir, packageRoot, parentModel }) {
  const args = [
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--approve",
    "-ne",
    "--no-prompt-templates",
    "-e",
    packageRoot,
  ];
  if (parentModel) args.push("--model", parentModel);
  args.push(`Call the subagent tool exactly once with this input and then stop:\n${JSON.stringify(input)}`);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("PI_SUBAGENT_")),
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
    throw new Error(`${label}: Pi command failed: ${result.error?.message ?? `exit ${result.status}`}\n${rawOutput}`);
  }
  const shape = collectSubagentEvents(parseJsonLines(result.stdout, label));
  try {
    validateShapeContract({
      label,
      expectedModel,
      expectedThinking,
      expectedFinalChildren,
      requireUniqueSiblingIds: expectedFinalChildren > 1,
      requireThinking,
      shape,
    });
  } catch (error) {
    throw new Error(
      `${label}: ${error instanceof Error ? error.message : String(error)}\nRaw Pi output:\n${rawOutput}`,
    );
  }
  console.log(`${label}: ${requireThinking ? "metadata contract passed" : "absence contract passed"}`);
}

async function main() {
  const pin = readRootPin();
  const packageRoot = resolvePiSubagentsRoot();
  assertInstalledPackage(pin, packageRoot);
  const model = requiredEnvironment("PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL");
  const thinking = process.env.PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING ?? "low";
  const noThinkingModel = requiredEnvironment("PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL");
  const parentModel = process.env.PATCHMILL_PI_SUBAGENTS_PARENT_MODEL;
  const cwd = await mkdtemp(join(tmpdir(), "patchmill-pi-subagents-contract-"));
  try {
    const agentsDir = join(cwd, ".pi", "agents");
    const legacyAgentsDir = join(cwd, ".agents");
    await Promise.all([mkdir(agentsDir, { recursive: true }), mkdir(legacyAgentsDir)]);
    const thinkingAgent = agentDefinition({ name: "contract-thinking", model, thinking });
    const noThinkingAgent = agentDefinition({ name: "contract-no-thinking", model: noThinkingModel });
    await Promise.all([
      writeFile(join(agentsDir, "contract-thinking.md"), thinkingAgent),
      writeFile(join(agentsDir, "contract-no-thinking.md"), noThinkingAgent),
      writeFile(join(legacyAgentsDir, "contract-thinking.md"), thinkingAgent),
      writeFile(join(legacyAgentsDir, "contract-no-thinking.md"), noThinkingAgent),
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
    runShape({ ...common, label: "direct", expectedFinalChildren: 1, input: { agent: "contract-thinking", task: "Return the word direct.", context: "fresh" } });
    runShape({ ...common, label: "counted", expectedFinalChildren: 2, input: { tasks: [{ agent: "contract-thinking", task: "Return the word counted.", count: 2 }], concurrency: 2, context: "fresh" } });
    runShape({ ...common, label: "parallel", expectedFinalChildren: 3, input: { tasks: [{ agent: "contract-thinking", task: "Return parallel a." }, { agent: "contract-thinking", task: "Return repeated parallel.", count: 2 }], concurrency: 2, context: "fresh" } });
    runShape({ ...common, label: "chain", expectedFinalChildren: 3, input: { chain: [{ agent: "contract-thinking", task: "Return chain step one." }, { parallel: [{ agent: "contract-thinking", task: "Return chain fanout a." }, { agent: "contract-thinking", task: "Return chain fanout b." }] }], context: "fresh", clarify: false } });
    runShape({ cwd, agentsDir, packageRoot, parentModel, label: "no-thinking", expectedFinalChildren: 1, expectedModel: noThinkingModel, requireThinking: false, input: { agent: "contract-no-thinking", task: "Return the words no thinking.", context: "fresh" } });
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
