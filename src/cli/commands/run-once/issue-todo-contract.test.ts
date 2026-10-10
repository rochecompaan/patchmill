import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PI_TASK_CONTRACT as contract } from "../../../policy/task-contract.ts";
import {
  resolveIssueTodoContract,
  resolveResumedIssueTodoContract,
  sharedIssueTodoScope,
} from "./issue-todo-contract.ts";

const workspace = "/repo/.worktrees/patchmill-issue-226-implementation";

test("default todos and relative custom roots use the actual workspace", () => {
  assert.equal(
    resolveIssueTodoContract(workspace, contract).todoRoot,
    `${workspace}/.pi/todos`,
  );
  assert.equal(
    resolveIssueTodoContract(workspace, {
      ...contract,
      todoRoot: "custom/tasks",
    }).todoRoot,
    `${workspace}/custom/tasks`,
  );
  assert.equal(
    sharedIssueTodoScope(
      workspace,
      resolveIssueTodoContract(workspace, contract),
      226,
    ),
    undefined,
  );
});

test("resume preserves its previous shared todo root", () => {
  assert.equal(
    resolveIssueTodoContract(workspace, contract, "/repo/.pi/todos").todoRoot,
    "/repo/.pi/todos",
  );
  const scoped = sharedIssueTodoScope(
    workspace,
    resolveIssueTodoContract(workspace, contract, "/repo/.pi/todos"),
    226,
  )!;
  assert.equal(
    new RegExp(scoped.titlePattern).test("issue-226-task-01-example"),
    true,
  );
  assert.equal(
    new RegExp(scoped.titlePattern).test("issue-227-task-01-example"),
    false,
  );
});

test("a saved root cannot redirect another issue's phase workspace", () => {
  assert.throws(
    () =>
      resolveIssueTodoContract(
        workspace,
        contract,
        "/repo/.worktrees/patchmill-issue-227-implementation/.pi/todos",
      ),
    /another workspace/u,
  );
});

test("ambiguous existing todo locations fail without moving or combining tasks", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "issue-todo-resume-"));
  const worktreeRoot = join(repoRoot, ".worktrees", "issue-226");
  const body = `${JSON.stringify({ id: "abcdef01", title: "issue-226-task-01-existing", tags: ["agent-issue", "issue-226"], status: "closed" })}\n\nOriginal task\n`;
  const oldRoot = join(repoRoot, ".pi", "todos");
  const newRoot = join(worktreeRoot, ".pi", "todos");
  try {
    await mkdir(oldRoot, { recursive: true });
    await writeFile(join(oldRoot, "abcdef01.md"), body);
    const resumed = await resolveResumedIssueTodoContract({
      repoRoot,
      worktreeRoot,
      contract,
      issueNumber: 226,
    });
    assert.equal(resumed.todoRoot, oldRoot);
    await mkdir(newRoot, { recursive: true });
    await writeFile(join(newRoot, "abcdef01.md"), body);
    await assert.rejects(
      resolveResumedIssueTodoContract({
        repoRoot,
        worktreeRoot,
        contract,
        issueNumber: 226,
      }),
      /Ambiguous/u,
    );
    assert.equal(await readFile(join(oldRoot, "abcdef01.md"), "utf8"), body);
    assert.equal(await readFile(join(newRoot, "abcdef01.md"), "utf8"), body);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("canonical aliases are one existing todo location rather than ambiguous evidence", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "issue-todo-alias-"));
  const worktreeRoot = join(repoRoot, ".worktrees", "issue-226");
  const newRoot = join(worktreeRoot, ".pi", "todos");
  try {
    await mkdir(newRoot, { recursive: true });
    await mkdir(join(repoRoot, ".pi"));
    await symlink(newRoot, join(repoRoot, ".pi", "todos"));
    await writeFile(
      join(newRoot, "abcdef01.md"),
      `${JSON.stringify({ title: "issue-226-task-01-existing", status: "closed" })}\n\nTask\n`,
    );
    assert.equal(
      (
        await resolveResumedIssueTodoContract({
          repoRoot,
          worktreeRoot,
          contract,
          issueNumber: 226,
        })
      ).todoRoot,
      newRoot,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("shared roots require an issue-specific title or tag before Pi starts", () => {
  const shared = {
    ...contract,
    todoRoot: "/shared/todos",
    todoTitlePattern: "task-<two-digit-number>-<slug>",
    todoTags: ["agent-issue"],
  };
  assert.throws(
    () => sharedIssueTodoScope(workspace, shared, 226),
    /issue-specific/u,
  );
  assert.deepEqual(
    sharedIssueTodoScope(
      workspace,
      { ...shared, todoTags: ["issue-<number>"] },
      226,
    )?.tags,
    ["issue-226"],
  );
});
