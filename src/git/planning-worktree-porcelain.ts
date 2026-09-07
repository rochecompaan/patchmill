import { isAbsolute, normalize } from "node:path";
import { isPlanningBranch, planningOid } from "./planning-git-validation.ts";

export type PlanningWorktreeRegistration = Readonly<{
  path: string;
  headOid: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}>;
function validMarkerValue(value: string): boolean {
  return value.length > 0 && !/[\x00-\x1f\x7f\r\n]/u.test(value);
}
export function parsePlanningWorktreePorcelain(output: string): Readonly<{
  entries: readonly PlanningWorktreeRegistration[];
  malformed: boolean;
}> {
  if (output !== "" && !output.endsWith("\0\0"))
    return { entries: [], malformed: true };
  const entries: PlanningWorktreeRegistration[] = [];
  const paths = new Set<string>(),
    branches = new Set<string>();
  for (const block of output.split("\0\0").filter(Boolean)) {
    const fields = block.split("\0");
    const values = new Map<string, string>();
    let malformed = false;
    for (const field of fields) {
      const separator = field.indexOf(" ");
      const key = separator === -1 ? field : field.slice(0, separator);
      const value = separator === -1 ? "" : field.slice(separator + 1);
      if (
        ![
          "worktree",
          "HEAD",
          "branch",
          "detached",
          "locked",
          "prunable",
        ].includes(key) ||
        values.has(key) ||
        (key === "detached" && value !== "") ||
        ((key === "locked" || key === "prunable") &&
          value !== "" &&
          !validMarkerValue(value)) ||
        ((key === "worktree" || key === "HEAD" || key === "branch") &&
          value === "")
      ) {
        malformed = true;
        break;
      }
      values.set(key, value);
    }
    const path = values.get("worktree"),
      head = values.get("HEAD"),
      ref = values.get("branch");
    if (
      malformed ||
      path === undefined ||
      head === undefined ||
      !isAbsolute(path) ||
      !planningOid.test(head) ||
      (ref !== undefined &&
        (!ref.startsWith("refs/heads/") ||
          ref.length === 11 ||
          !isPlanningBranch(ref.slice(11)))) ||
      (values.has("detached") && ref !== undefined) ||
      (!values.has("detached") && ref === undefined)
    ) {
      return { entries: [], malformed: true };
    }
    const branch = ref?.slice("refs/heads/".length);
    const normalized = normalize(path);
    if (paths.has(normalized) || (branch !== undefined && branches.has(branch)))
      return { entries: [], malformed: true };
    paths.add(normalized);
    if (branch !== undefined) branches.add(branch);
    entries.push({
      path: normalized,
      headOid: head,
      ...(branch === undefined ? {} : { branch }),
      detached: values.has("detached"),
      locked: values.has("locked"),
      prunable: values.has("prunable"),
    });
  }
  return { entries, malformed: false };
}
