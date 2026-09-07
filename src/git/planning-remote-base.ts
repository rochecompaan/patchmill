import { basename, isAbsolute, relative, resolve } from "node:path";
import type { CommandRunner } from "../process/command.ts";
import {
  PlanningWorkspaceCommandError,
  PlanningWorkspaceResponseError,
} from "./planning-workspaces.ts";
import type { PlanningRemoteBaseSnapshot } from "./planning-workspaces.ts";
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
function directory(root: string, value: string): string {
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
function check(
  result: { code: number },
  operation: "fetch" | "ref-resolution" | "tree-inspection",
): void {
  if (result.code !== 0)
    throw new PlanningWorkspaceCommandError(
      operation,
      result as { code: number; stdout: string; stderr: string },
    );
}
export class PlanningRemoteBaseGit {
  readonly runner: CommandRunner;
  readonly repoRoot: string;
  readonly specsDir: string;
  readonly plansDir: string;
  constructor(input: {
    runner: CommandRunner;
    repoRoot: string;
    specsDir: string;
    plansDir: string;
  }) {
    this.runner = input.runner;
    this.repoRoot = resolve(input.repoRoot);
    this.specsDir = directory(this.repoRoot, input.specsDir);
    this.plansDir = directory(this.repoRoot, input.plansDir);
  }
  async fetch(input: {
    issueNumber: number;
    remote: string;
    baseBranch: string;
  }): Promise<PlanningRemoteBaseSnapshot> {
    if (
      !Number.isSafeInteger(input.issueNumber) ||
      input.issueNumber < 1 ||
      !input.remote ||
      !input.baseBranch
    )
      throw new RangeError("Invalid planning remote-base input");
    const ref = `refs/remotes/${input.remote}/${input.baseBranch}`;
    let result = await this.runner.run(
      "git",
      [
        "fetch",
        "--no-tags",
        "--",
        input.remote,
        `+refs/heads/${input.baseBranch}:${ref}`,
      ],
      { cwd: this.repoRoot },
    );
    check(result, "fetch");
    result = await this.runner.run(
      "git",
      ["rev-parse", "--verify", `${ref}^{commit}`],
      { cwd: this.repoRoot },
    );
    check(result, "ref-resolution");
    const baseOid = result.stdout.trim();
    if (!OID.test(baseOid))
      throw new PlanningWorkspaceResponseError(
        "ref-resolution",
        "invalid-object-id",
      );
    result = await this.runner.run(
      "git",
      [
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        baseOid,
        "--",
        this.specsDir,
        this.plansDir,
      ],
      { cwd: this.repoRoot },
    );
    check(result, "tree-inspection");
    const spec: string[] = [];
    const plan: string[] = [];
    const seen = new Set<string>();
    if (result.stdout !== "" && !result.stdout.endsWith("\0"))
      throw new PlanningWorkspaceResponseError(
        "tree-inspection",
        "unterminated-record",
      );
    for (const record of result.stdout.split("\0").filter(Boolean)) {
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
      if (!OID.test(objectId!) || seen.has(path!))
        throw new PlanningWorkspaceResponseError(
          "tree-inspection",
          seen.has(path!) ? "duplicate-entry" : "malformed-record",
        );
      seen.add(path!);
      if ((mode !== "100644" && mode !== "100755") || type !== "blob") continue;
      if (basename(path!).includes(`-issue-${input.issueNumber}-`)) {
        if (path === this.specsDir || path!.startsWith(`${this.specsDir}/`))
          spec.push(path!);
        if (path === this.plansDir || path!.startsWith(`${this.plansDir}/`))
          plan.push(path!);
      }
    }
    return Object.freeze({
      remote: input.remote,
      baseBranch: input.baseBranch,
      baseOid,
      artifactCandidates: Object.freeze({
        spec: Object.freeze(spec.sort()),
        plan: Object.freeze(plan.sort()),
      }),
    });
  }
}
