#!/usr/bin/env bun
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const workflowEngineVersion = "0.41.0";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) throw new Error(`Invalid pi-subagents version: ${version}`);
  return match.slice(1).map(Number);
}

function versionAtLeast(version, minimum) {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== required[index])
      return actual[index] > required[index];
  }
  return true;
}

if (!process.versions.bun) {
  throw new Error("The pi-subagents Bun workflow contract must run under Bun");
}

const packageRoot = dirname(require.resolve("pi-subagents"));
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
const version = manifest.version;

if (!versionAtLeast(version, workflowEngineVersion)) {
  console.log(
    `pi-subagents ${version} predates the workflow engine; Bun workflow contract not required`,
  );
  process.exit(0);
}

const enginePath = join(
  packageRoot,
  "src",
  "workflows",
  "scripted-workflow.ts",
);
assert.equal(
  existsSync(enginePath),
  true,
  `pi-subagents ${version} workflow engine moved; update the Bun compatibility contract`,
);

try {
  const { runWorkflowScript } = await import(pathToFileURL(enginePath).href);
  assert.equal(
    typeof runWorkflowScript,
    "function",
    `pi-subagents ${version} does not export runWorkflowScript from ${enginePath}`,
  );

  let launches = 0;
  const childResult = {
    key: "child",
    ok: true,
    agent: "oracle",
    runId: "patchmill-bun-contract-child",
    output: "ok",
    artifactPaths: [],
  };
  const result = await runWorkflowScript({
    script:
      'return await runs.run("child", { agent: "oracle", task: "Say ok" });',
    timeoutMs: 5_000,
    launch: async () => {
      launches += 1;
      return childResult;
    },
    status: async () => childResult,
  });

  assert.equal(launches, 1, "workflow did not launch exactly one child");
  assert.equal(result.value?.ok, true, "workflow child did not succeed");
  assert.equal(result.value?.output, "ok", "workflow output was not returned");
  assert.equal(result.children.length, 1, "workflow did not record its child");
} catch (error) {
  throw new Error(
    `pi-subagents ${version} cannot execute a one-child workflow under Bun; this would break Patchmill delegation (see nicobailon/pi-subagents#1158): ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

console.log(
  `pi-subagents ${version} executed a one-child workflow under Bun ${process.versions.bun}`,
);
