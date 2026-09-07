import { isAbsolute, normalize } from "node:path";
export type PlanningWorktreeRegistration = Readonly<{
  path: string;
  headOid: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}>;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BRANCH =
  /^(?!-)(?!\/)(?!.*(?:\.\.|@\{|[\s\\~^:?*[]))(?!.*(?:\/\/|\/$|\.$)).+$/u;
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
      const [key, ...rest] = field.split(" ");
      if (
        ![
          "worktree",
          "HEAD",
          "branch",
          "detached",
          "locked",
          "prunable",
        ].includes(key!) ||
        values.has(key!)
      ) {
        malformed = true;
        break;
      }
      values.set(key!, rest.join(" "));
    }
    const path = values.get("worktree"),
      head = values.get("HEAD"),
      ref = values.get("branch");
    if (
      malformed ||
      path === undefined ||
      head === undefined ||
      !isAbsolute(path) ||
      !OID.test(head) ||
      (ref !== undefined &&
        (!ref.startsWith("refs/heads/") ||
          ref.length === 11 ||
          !BRANCH.test(ref.slice(11)))) ||
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
