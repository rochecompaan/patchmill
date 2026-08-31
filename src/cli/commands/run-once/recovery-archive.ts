import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RunRecoveryAssessment,
  RunRecoveryDecision,
  RunStateSnapshot,
} from "./types.ts";

export async function archiveRunRecovery(input: {
  runStateDir: string;
  /** The leased CLI issue, validated before this archive is created. */
  issueNumber: number;
  snapshot: RunStateSnapshot;
  assessment: RunRecoveryAssessment;
  decision: Extract<RunRecoveryDecision, { action: "archive-reset-and-start" }>;
  command: "patchmill run reset";
  baseRef: string;
  now: Date;
}): Promise<{ path: string }> {
  const root = join(input.runStateDir, "archive", `issue-${input.issueNumber}`);
  await mkdir(root, { recursive: true });
  const stamp = input.now.toISOString().replaceAll(/[:.]/gu, "-");
  let target = join(root, stamp);
  let suffix = 1;
  const temporary = join(root, `.${stamp}-${randomUUID()}.tmp`);
  try {
    await mkdir(temporary);
    await writeFile(
      join(temporary, "run-state.json"),
      input.snapshot.raw,
      "utf8",
    );
    const report = {
      version: 1,
      archivedAt: input.now.toISOString(),
      command: input.command,
      issueNumber: input.issueNumber,
      baseRef: input.baseRef,
      baseOid: input.assessment.baseOid,
      branchOid: input.assessment.branch.oid,
      recoveryClassification: input.assessment.classification,
      divergence: input.assessment.divergence,
      actualUniqueCommits: input.assessment.actualUniqueCommits,
      savedCommits: input.assessment.savedCommits,
      worktree: input.assessment.worktree,
      leaseProtocolVersion: input.assessment.leaseProtocolVersion,
      legacyMigrationFenceValid: input.assessment.legacyMigrationFenceValid,
      fieldsSelectedForPreservation: [
        "issueNumber",
        "title",
        ...(input.decision.seed.specPath ? ["specPath", "specCommit"] : []),
        ...(input.decision.seed.planPath ? ["planPath", "planCommit"] : []),
        ...(input.decision.seed.startedCommentPosted
          ? ["startedCommentPosted"]
          : []),
      ],
      cleanup: input.decision.cleanup,
    };
    await writeFile(
      join(temporary, "recovery-assessment.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    while (true) {
      try {
        await rename(temporary, target);
        break;
      } catch (error) {
        if (
          !["EEXIST", "ENOTEMPTY"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        target = join(root, `${stamp}-${suffix++}`);
      }
    }
    return { path: target };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}
