import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  isPlanningArtifactPath,
  planningOid,
} from "./planning-git-validation.ts";
import {
  PlanningWorkspaceResponseError,
  type PlanningArtifactCandidates,
} from "./planning-workspaces.ts";

export function planningArtifactDirectory(root: string, value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const path = relative(root, absolute).replaceAll("\\", "/");
  if (
    path === "" ||
    isAbsolute(path) ||
    path === ".." ||
    path.startsWith("../")
  )
    throw new RangeError(
      "Planning artifact directory must be inside repository root",
    );
  return path;
}

/** Shared committed-tree discovery for fetched bases and interrupted artifacts. */
export function parsePlanningArtifactCandidates(input: {
  stdout: string;
  issueNumber: number;
  specsDir: string;
  plansDir: string;
}): PlanningArtifactCandidates {
  const spec: string[] = [];
  const plan: string[] = [];
  const seen = new Set<string>();
  if (input.stdout !== "" && !input.stdout.endsWith("\0"))
    throw new PlanningWorkspaceResponseError(
      "tree-inspection",
      "unterminated-record",
    );
  for (const record of input.stdout.split("\0").filter(Boolean)) {
    const match =
      /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0\r\n]+)$/u.exec(
        record,
      );
    if (match === null)
      throw new PlanningWorkspaceResponseError(
        "tree-inspection",
        "malformed-record",
      );
    const [mode, type, objectId, path] = match.slice(1);
    if (
      !planningOid.test(objectId!) ||
      !isPlanningArtifactPath(path!) ||
      seen.has(path!)
    )
      throw new PlanningWorkspaceResponseError(
        "tree-inspection",
        seen.has(path!)
          ? "duplicate-entry"
          : !isPlanningArtifactPath(path!)
            ? "invalid-path"
            : "malformed-record",
      );
    if (
      (mode === "160000" && type !== "commit") ||
      (mode !== "160000" && type !== "blob")
    )
      throw new PlanningWorkspaceResponseError(
        "tree-inspection",
        "invalid-mode-type",
      );
    seen.add(path!);
    if (mode === "120000" || mode === "160000") continue;
    if (basename(path!).includes(`-issue-${input.issueNumber}-`)) {
      if (path === input.specsDir || path!.startsWith(`${input.specsDir}/`))
        spec.push(path!);
      if (path === input.plansDir || path!.startsWith(`${input.plansDir}/`))
        plan.push(path!);
    }
  }
  return Object.freeze({
    spec: Object.freeze(spec.sort()),
    plan: Object.freeze(plan.sort()),
  });
}
