import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { planningIssueLockPath } from "../../src/workflow/planning-issue-lock.ts";
import type { PlanningStateV1 } from "../../src/workflow/planning-state-store.ts";
import type {
  PlanningScenarioEffect,
  PlanningScenarioFailurePoint,
} from "./planning-provider-scenario-types.ts";

/** Controls fixture-only persistence failures and explicit stale-lock archival. */
export function createPlanningRecoveryControl(input: {
  runStateDir: string;
  issueNumber: number;
  now: Date;
  record(effect: PlanningScenarioEffect): void;
}) {
  const issueStateDirectory = join(
    input.runStateDir,
    "planning-pr-v1",
    "issues",
  );
  let pendingInterrupt: PlanningScenarioFailurePoint | undefined;
  let persistenceDenied = false;
  return {
    interruptAt(point: PlanningScenarioFailurePoint) {
      if (pendingInterrupt !== undefined)
        throw new Error(
          `persistence interruption already armed: ${pendingInterrupt}`,
        );
      pendingInterrupt = point;
    },
    async interruptAfter(point: PlanningScenarioFailurePoint) {
      if (pendingInterrupt !== point || persistenceDenied) return;
      await chmod(issueStateDirectory, 0o500);
      persistenceDenied = true;
      pendingInterrupt = undefined;
      input.record({
        kind: "interrupt",
        operation: "persistence-interrupt",
        point,
      });
    },
    async restorePersistence() {
      if (!persistenceDenied) return;
      await chmod(issueStateDirectory, 0o700);
      persistenceDenied = false;
    },
    async installDeadProcessLock(state: PlanningStateV1 | undefined) {
      assert.ok(
        state,
        "planning state must exist before a stale lock is installed",
      );
      const path = planningIssueLockPath(input.runStateDir, input.issueNumber);
      await mkdir(dirname(path), { recursive: true });
      const bytes = Buffer.from(
        `${JSON.stringify({
          version: 1,
          issueNumber: input.issueNumber,
          runId: state.runId,
          ownershipId: "11111111-1111-4111-8111-111111111111",
          pid: 999999,
          hostname: hostname(),
          acquiredAt: input.now.toISOString(),
        })}\n`,
        "utf8",
      );
      await writeFile(path, bytes, { mode: 0o600 });
      return { fingerprint: createHash("sha256").update(bytes).digest("hex") };
    },
    async archiveExactStaleLock() {
      const path = planningIssueLockPath(input.runStateDir, input.issueNumber);
      const bytes = await readFile(path);
      const fingerprint = createHash("sha256").update(bytes).digest("hex");
      const archivePath = join(
        input.runStateDir,
        "planning-pr-v1",
        "archives",
        `issue-${input.issueNumber}.${fingerprint}.lock`,
      );
      await mkdir(dirname(archivePath), { recursive: true });
      await rename(path, archivePath);
      assert.deepEqual(await readFile(archivePath), bytes);
      return { fingerprint, archivePath };
    },
    async cleanup() {
      await chmod(issueStateDirectory, 0o700).catch(() => undefined);
    },
  };
}
