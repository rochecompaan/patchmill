import { isAbsolute, resolve } from "node:path";

export type RegisteredWorktree = {
  path: string;
  branch?: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  malformed: boolean;
  seen: boolean;
};

function validBranchName(branch: string): boolean {
  return (
    branch.length > 0 &&
    !/[\x00-\x20\x7f~^:?*\\[\\\\]/u.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    !branch.endsWith(".") &&
    !branch.endsWith("/") &&
    !branch.startsWith("/") &&
    !branch.includes("//")
  );
}

/** Parse the complete documented `git worktree list --porcelain` grammar.
 * A malformed record anywhere is global unsafe evidence for recovery. */
export function parseWorktreeRegistrations(output: string): {
  entries: RegisteredWorktree[];
  malformed: boolean;
} {
  const entries: RegisteredWorktree[] = [];
  let malformed = false;
  let entry: RegisteredWorktree;
  let worktrees: number;
  let heads: number;
  let branchFields: number;
  let detached: number;
  let bares: number;
  let locks: number;
  let prunables: number;
  const reset = () => {
    entry = {
      path: "",
      bare: false,
      locked: false,
      prunable: false,
      malformed: false,
      seen: false,
    };
    worktrees = 0;
    heads = 0;
    branchFields = 0;
    detached = 0;
    bares = 0;
    locks = 0;
    prunables = 0;
  };
  reset();
  const finish = () => {
    if (!entry.seen) return;
    const linked =
      worktrees === 1 &&
      heads === 1 &&
      branchFields + detached === 1 &&
      bares === 0;
    const bare =
      worktrees === 1 &&
      bares === 1 &&
      heads === 0 &&
      branchFields === 0 &&
      detached === 0;
    if (!linked && !bare) entry.malformed = true;
    if (entry.path) entries.push(entry);
    if (entry.malformed) malformed = true;
    reset();
  };
  for (const line of output.split("\n")) {
    if (line === "") {
      finish();
      continue;
    }
    entry.seen = true;
    if (line.startsWith("worktree ")) {
      const path = line.slice("worktree ".length);
      worktrees += 1;
      if (worktrees > 1 || !path || !isAbsolute(path)) entry.malformed = true;
      else entry.path = resolve(path);
    } else if (line.startsWith("HEAD ")) {
      const head = line.slice("HEAD ".length);
      heads += 1;
      if (heads > 1 || !/^[0-9a-f]{7,64}$/iu.test(head)) entry.malformed = true;
    } else if (line.startsWith("branch refs/heads/")) {
      const branch = line.slice("branch refs/heads/".length);
      branchFields += 1;
      if (branchFields > 1 || !validBranchName(branch)) entry.malformed = true;
      else entry.branch = branch;
    } else if (line === "detached") {
      detached += 1;
      if (detached > 1) entry.malformed = true;
    } else if (line === "bare") {
      bares += 1;
      if (bares > 1) entry.malformed = true;
      else entry.bare = true;
    } else if (line === "locked" || /^locked [^\r\n]+$/u.test(line)) {
      locks += 1;
      if (locks > 1) entry.malformed = true;
      else entry.locked = true;
    } else if (line === "prunable" || /^prunable [^\r\n]+$/u.test(line)) {
      prunables += 1;
      if (prunables > 1) entry.malformed = true;
      else entry.prunable = true;
    } else entry.malformed = true;
  }
  finish();
  const paths = new Set<string>();
  const branches = new Set<string>();
  for (const item of entries) {
    if (paths.has(item.path) || (item.branch && branches.has(item.branch)))
      malformed = true;
    paths.add(item.path);
    if (item.branch) branches.add(item.branch);
  }
  return { entries, malformed };
}
