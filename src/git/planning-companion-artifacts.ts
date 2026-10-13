import type { CommandRunner } from "../command/types.ts";
import {
  parsePlanningCompanionPaths,
  planningArtifactPaths,
  PlanningCompanionArtifactError,
} from "../workflow/planning-companion-artifacts.ts";
import type { PlanningArtifactKind } from "../workflow/planning-pull-requests.ts";
import type { PlanningArtifactEvidence } from "../workflow/planning-state-types.ts";
import {
  isPlanningArtifactPath,
  planningOid,
} from "./planning-git-validation.ts";
import { PlanningPublicationGitError } from "./planning-publication-git-errors.ts";

type GitInput = { runner: CommandRunner; repoRoot: string };
export type PlanningArtifactInspectionInput = {
  kind: PlanningArtifactKind;
  path: string;
  commitOid: string;
  source: PlanningArtifactEvidence["source"];
};

export async function assertPlanningRegularFiles(
  input: GitInput & { commitOid: string; paths: readonly string[] },
): Promise<void> {
  if (
    !planningOid.test(input.commitOid) ||
    input.paths.length === 0 ||
    input.paths.some((path) => !isPlanningArtifactPath(path))
  )
    throw new PlanningPublicationGitError("tree", "invalid-input");
  for (const path of input.paths) {
    const result = await input.runner.run(
      "git",
      ["ls-tree", "-z", input.commitOid, "--", path],
      { cwd: input.repoRoot },
    );
    if (result.code !== 0)
      throw new PlanningPublicationGitError("tree", "command-failed", result);
    if (result.stdout !== "" && !result.stdout.endsWith("\0"))
      throw new PlanningPublicationGitError(
        "tree",
        "malformed-response",
        result,
      );
    const records = result.stdout.split("\0").filter(Boolean);
    const match =
      records.length === 1
        ? /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0\r\n]+)$/u.exec(
            records[0]!,
          )
        : null;
    if (match === null || match[3] !== path)
      throw new PlanningPublicationGitError("tree", "non-regular-file", result);
  }
}

/** The immutable spec blob, not cached paths or worktree content, grants authority. */
export async function readPlanningArtifactEvidence(
  input: GitInput & PlanningArtifactInspectionInput,
): Promise<PlanningArtifactEvidence> {
  if (input.kind !== "spec" && input.kind !== "plan")
    throw new PlanningPublicationGitError("tree", "invalid-input");
  await assertPlanningRegularFiles({ ...input, paths: [input.path] });
  const evidence: PlanningArtifactEvidence = {
    kind: input.kind,
    path: input.path,
    commitOid: input.commitOid,
    source: input.source,
  };
  if (input.kind === "plan") return evidence;
  const blob = await input.runner.run(
    "git",
    ["show", `${input.commitOid}:${input.path}`],
    { cwd: input.repoRoot },
  );
  if (blob.code !== 0)
    throw new PlanningPublicationGitError("tree", "command-failed", blob);
  let companionPaths: readonly string[];
  try {
    companionPaths = parsePlanningCompanionPaths({
      specPath: input.path,
      body: blob.stdout,
    });
  } catch (error) {
    if (error instanceof PlanningCompanionArtifactError)
      throw new PlanningPublicationGitError("tree", "invalid-companion");
    throw error;
  }
  if (companionPaths.length > 0)
    await assertPlanningRegularFiles({ ...input, paths: companionPaths });
  return companionPaths.length === 0
    ? evidence
    : { ...evidence, companionPaths };
}

/** Inspect both trees; a retired companion is allowed only as an exact deletion. */
export async function inspectPlanningRevision(
  input: GitInput & {
    recordedOid: string;
    candidateOid: string;
    artifacts: readonly PlanningArtifactEvidence[];
  },
): Promise<{
  artifacts: readonly PlanningArtifactEvidence[];
  unexpectedPaths: readonly string[];
}> {
  const before: PlanningArtifactEvidence[] = [];
  const after: PlanningArtifactEvidence[] = [];
  for (const artifact of input.artifacts) {
    before.push(
      await readPlanningArtifactEvidence({
        ...input,
        ...artifact,
        commitOid: input.recordedOid,
      }),
    );
    after.push(
      await readPlanningArtifactEvidence({
        ...input,
        ...artifact,
        commitOid: input.candidateOid,
        source: "workspace",
      }),
    );
  }
  const diff = await input.runner.run(
    "git",
    [
      "diff",
      "--name-status",
      "--no-renames",
      "-z",
      input.recordedOid,
      input.candidateOid,
      "--",
    ],
    { cwd: input.repoRoot },
  );
  if (diff.code !== 0)
    throw new PlanningPublicationGitError("diff", "command-failed", diff);
  if (diff.stdout !== "" && !diff.stdout.endsWith("\0"))
    throw new PlanningPublicationGitError("diff", "malformed-response", diff);
  const records =
    diff.stdout === "" ? [] : diff.stdout.slice(0, -1).split("\0");
  if (records.length % 2 !== 0)
    throw new PlanningPublicationGitError("diff", "malformed-response", diff);
  const allowed = new Set(planningArtifactPaths(after));
  const retired = new Set(
    planningArtifactPaths(before).filter((path) => !allowed.has(path)),
  );
  const unexpected: string[] = [];
  for (let index = 0; index < records.length; index += 2) {
    const status = records[index]!;
    const path = records[index + 1]!;
    if (!/^[ACDMTUXB]$/u.test(status) || path === "")
      throw new PlanningPublicationGitError("diff", "malformed-response", diff);
    if (!allowed.has(path) && !(status === "D" && retired.has(path)))
      unexpected.push(path);
  }
  return { artifacts: after, unexpectedPaths: [...new Set(unexpected)].sort() };
}
