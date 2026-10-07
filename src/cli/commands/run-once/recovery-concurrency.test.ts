import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  acquireIssueRunLease,
  releaseIssueRunLease,
} from "./recovery-lease.ts";
import { exitCodeForRunOnceResult } from "./result-output.ts";
import { resetIssueRun } from "../run/reset/reset.ts";
import { withRunAdmission } from "../../../workflow/run-admission.ts";
import {
  resolveRunOnceRepositoryNamespace,
  withRunRecoveryAdmission,
} from "./repository-admission.ts";
import { createLegacyPrScenario } from "../../../../test-support/run-once/legacy-pr-scenario.ts";

test("reset cannot take planning ownership or erase a published PR", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    const root = join(scenario.config.runStateDir, "planning-pr-v1", "issues");
    await mkdir(root, { recursive: true });
    const planning = join(root, "issue-226.json");
    await writeFile(planning, '{"planning":"preserve"}\n');
    const raw = await scenario.raw();
    await assert.rejects(
      resetIssueRun(scenario.runner, { ...scenario.config, issueNumber: 226 }),
      /planning/u,
    );
    assert.equal(await scenario.raw(), raw);
    assert.equal(await readFile(planning, "utf8"), '{"planning":"preserve"}\n');
    assert.deepEqual(scenario.effects, []);
    await rm(planning);
    await assert.rejects(
      resetIssueRun(scenario.runner, { ...scenario.config, issueNumber: 226 }),
      /published.*PR|PR.*reconciliation/u,
    );
    assert.equal(await scenario.raw(), raw);
    assert.deepEqual(scenario.effects, []);
  } finally {
    await scenario.cleanup();
  }
});

test("reset stops normally on a live common owner without changing its lease or state", async () => {
  const scenario = await createLegacyPrScenario();
  const lease = await acquireIssueRunLease(scenario.config.runStateDir, 226);
  try {
    const raw = await scenario.raw();
    const leaseRaw = await readFile(lease.path, "utf8");
    const result = await resetIssueRun(scenario.runner, {
      ...scenario.config,
      issueNumber: 226,
    });
    assert.equal(result.status, "stopped");
    if (result.status !== "stopped") assert.fail("not a normal stop");
    assert.equal(exitCodeForRunOnceResult(result.pipelineResult), 0);
    assert.equal(await scenario.raw(), raw);
    assert.equal(await readFile(lease.path, "utf8"), leaseRaw);
    assert.deepEqual(scenario.effects, []);
  } finally {
    await releaseIssueRunLease(lease);
    await scenario.cleanup();
  }
});

test("recovery admission rejects automatic overlap before reset mutation", async () => {
  const scenario = await createLegacyPrScenario();
  try {
    const namespace = await resolveRunOnceRepositoryNamespace(
      scenario.runner,
      scenario.config,
    );
    const raw = await scenario.raw();
    await withRunAdmission(
      { namespace, mode: "automatic", attemptId: "automatic" },
      async () => {
        await assert.rejects(
          resetIssueRun(scenario.runner, {
            ...scenario.config,
            issueNumber: 226,
          }),
          /admission conflicts/u,
        );
        await assert.rejects(
          withRunRecoveryAdmission(
            scenario.runner,
            scenario.config,
            227,
            async () => assert.fail("repair action must not start"),
          ),
          /admission conflicts/u,
        );
      },
    );
    assert.equal(await scenario.raw(), raw);
    assert.deepEqual(scenario.effects, []);
  } finally {
    await scenario.cleanup();
  }
});
