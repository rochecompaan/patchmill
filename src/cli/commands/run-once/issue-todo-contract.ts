import { dirname, isAbsolute, relative, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import {
  compileIssueTodoTitlePattern,
  renderIssueTodoTags,
  resolveTodoRoot,
  todoTitlePatternIncludesIssueNumber,
  type PatchmillPiTaskContract,
} from "../../../policy/task-contract.ts";
import type { TodoIssueScope } from "../../../policy/todo-issue-scope.ts";
import { readIssueTodoSummary } from "./issue-todos.ts";

function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path
    ? path
    : resolve(canonicalPath(parent), relative(parent, path));
}
function contained(root: string, path: string): boolean {
  const suffix = relative(canonicalPath(root), canonicalPath(path));
  return (
    suffix === "" ||
    (!suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      suffix !== ".." &&
      !isAbsolute(suffix))
  );
}

export function resolveIssueTodoContract(
  worktreeRoot: string,
  contract: PatchmillPiTaskContract,
  resumedTodoRoot?: string,
): PatchmillPiTaskContract {
  const workspace = resolve(worktreeRoot);
  if (
    resumedTodoRoot !== undefined &&
    (!isAbsolute(resumedTodoRoot) || /[\0\r\n]/u.test(resumedTodoRoot))
  )
    throw new Error("Invalid saved Issue todo root");
  const todoRoot = resolve(
    resumedTodoRoot ?? resolveTodoRoot(workspace, contract),
  );
  // An external configured root is shared. A saved sibling phase workspace is
  // never shared storage and cannot acquire authority over another Issue.
  if (
    resumedTodoRoot &&
    contained(dirname(workspace), todoRoot) &&
    !contained(workspace, todoRoot)
  )
    throw new Error("Saved Issue todo root belongs to another workspace");
  return { ...contract, todoRoot };
}

export function sharedIssueTodoScope(
  worktreeRoot: string,
  contract: PatchmillPiTaskContract,
  issueNumber: number,
): TodoIssueScope | undefined {
  if (contained(worktreeRoot, resolveTodoRoot(worktreeRoot, contract)))
    return undefined;
  const specificTitle = todoTitlePatternIncludesIssueNumber(contract);
  const specificTags = contract.todoTags.filter((tag) =>
    /<(?:issue-)?number>/u.test(tag),
  );
  if (!specificTitle && specificTags.length === 0)
    throw new Error("Shared todo roots require an issue-specific title or tag");
  return {
    ...(specificTitle
      ? {
          titlePattern: compileIssueTodoTitlePattern(contract, issueNumber)
            .source,
        }
      : {}),
    tags: renderIssueTodoTags(
      { ...contract, todoTags: specificTags },
      issueNumber,
    ),
  };
}

export async function resolveResumedIssueTodoContract(input: {
  repoRoot: string;
  worktreeRoot: string;
  contract: PatchmillPiTaskContract;
  issueNumber: number;
  savedTodoRoot?: string;
}): Promise<PatchmillPiTaskContract> {
  if (input.savedTodoRoot !== undefined)
    return resolveIssueTodoContract(
      input.worktreeRoot,
      input.contract,
      input.savedTodoRoot,
    );
  const effective = resolveIssueTodoContract(
    input.worktreeRoot,
    input.contract,
  );
  const previous = resolveTodoRoot(input.repoRoot, input.contract);
  if (
    canonicalPath(previous) === canonicalPath(effective.todoRoot) ||
    isAbsolute(input.contract.todoRoot)
  )
    return effective;
  const oldTasks = await readIssueTodoSummary(
    input.repoRoot,
    input.issueNumber,
    input.contract,
  );
  const newTasks = await readIssueTodoSummary(
    input.worktreeRoot,
    input.issueNumber,
    effective,
  );
  if (oldTasks.total && newTasks.total)
    throw new Error(
      "Ambiguous existing Issue todo locations; preserve both locations for inspection",
    );
  return oldTasks.total
    ? resolveIssueTodoContract(input.worktreeRoot, input.contract, previous)
    : effective;
}
